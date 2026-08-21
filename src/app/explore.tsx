import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  defaultSettings,
  loadSettings,
  parseBrokerUrl,
  saveSettings,
  type TrackerSettings,
} from '@/lib/settings';
import { applySettingsToRunningTracking, errorMessage } from '@/lib/tracking';

const PRIMARY_COLOR = '#208AEF';
const ERROR_COLOR = '#C42B2B';
const RELEASES_URL = 'https://github.com/Matt3o33/k-city-track/releases/latest';

type FieldProps = TextInputProps & { label: string; hint?: string };

function Field({ label, hint, ...inputProps }: FieldProps) {
  const theme = useTheme();
  return (
    <ThemedView style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: theme.backgroundElement, color: theme.text },
        ]}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        {...inputProps}
      />
      {hint && (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      )}
    </ThemedView>
  );
}

export default function SettingsScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();

  const [settings, setSettings] = useState<TrackerSettings>(defaultSettings);
  const [intervalText, setIntervalText] = useState(String(defaultSettings.intervalSec));
  const [distanceText, setDistanceText] = useState(String(defaultSettings.distanceM));
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const onCheckUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateStatus('Controllo aggiornamenti…');
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setUpdateStatus('Aggiornamento trovato, lo scarico…');
        await Updates.fetchUpdateAsync();
        setUpdateStatus('Riavvio con la nuova versione…');
        await Updates.reloadAsync();
      } else {
        setUpdateStatus("Sei già all'ultima versione.");
      }
    } catch (checkError) {
      setUpdateStatus(`Controllo non riuscito: ${errorMessage(checkError)}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    loadSettings().then((stored) => {
      setSettings(stored);
      setIntervalText(String(stored.intervalSec));
      setDistanceText(String(stored.distanceM));
      setLoaded(true);
    });
  }, []);

  const update = (patch: Partial<TrackerSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setFeedback(null);
  };

  const onSave = async () => {
    setError(null);
    setFeedback(null);
    try {
      if (settings.brokerUrl.trim()) {
        parseBrokerUrl(settings.brokerUrl);
      }
      const intervalSec = Math.max(1, Number.parseInt(intervalText, 10) || defaultSettings.intervalSec);
      const distanceM = Math.max(0, Number.parseInt(distanceText, 10) || 0);
      const next: TrackerSettings = {
        ...settings,
        brokerUrl: settings.brokerUrl.trim(),
        topic: settings.topic.trim(),
        clientId: settings.clientId.trim(),
        intervalSec,
        distanceM,
      };
      await saveSettings(next);
      setSettings(next);
      setIntervalText(String(intervalSec));
      setDistanceText(String(distanceM));
      await applySettingsToRunningTracking(next);
      setFeedback('Impostazioni salvate.');
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  };

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: safeAreaInsets.top,
      paddingBottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
    },
    web: {
      paddingTop: Spacing.six,
      paddingBottom: Spacing.four,
    },
  });

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentInset={{ bottom: BottomTabInset + Spacing.three }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}>
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" style={styles.title}>
          Impostazioni
        </ThemedText>

        <Field
          label="Broker MQTT"
          hint="Usa mqtts://host:porta per TLS oppure mqtt://host:porta in chiaro."
          placeholder="mqtts://mqtt.esempio.it:8883"
          keyboardType="url"
          value={settings.brokerUrl}
          onChangeText={(brokerUrl) => update({ brokerUrl })}
        />
        <Field
          label="Topic"
          placeholder="k-city-track/position"
          value={settings.topic}
          onChangeText={(topic) => update({ topic })}
        />
        <Field
          label="Tracker ID (tid)"
          hint="Identifica questo dispositivo nel payload OwnTracks, es. bus1, bus2…"
          placeholder="bus1"
          value={settings.trackerId}
          onChangeText={(trackerId) => update({ trackerId })}
        />
        <Field
          label="Client ID"
          placeholder="k-city-track-abc123"
          value={settings.clientId}
          onChangeText={(clientId) => update({ clientId })}
        />
        <Field
          label="Username"
          hint="Lascia vuoto se il broker non richiede autenticazione."
          value={settings.username}
          onChangeText={(username) => update({ username })}
        />
        <Field
          label="Password"
          secureTextEntry
          value={settings.password}
          onChangeText={(password) => update({ password })}
        />
        <Field
          label="Intervallo (secondi)"
          keyboardType="numeric"
          value={intervalText}
          onChangeText={setIntervalText}
        />
        <Field
          label="Distanza minima (metri)"
          keyboardType="numeric"
          value={distanceText}
          onChangeText={setDistanceText}
        />

        {error && (
          <ThemedText type="small" style={styles.errorText}>
            {error}
          </ThemedText>
        )}
        {feedback && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            {feedback}
          </ThemedText>
        )}

        <Pressable
          onPress={onSave}
          disabled={!loaded}
          style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
          <ThemedText style={styles.saveButtonText}>Salva impostazioni</ThemedText>
        </Pressable>

        <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
          Le modifiche vengono applicate automaticamente al tracciamento in corso.
        </ThemedText>

        <ThemedView style={styles.updatesSection}>
          <ThemedText type="smallBold" style={styles.centerText}>
            Aggiornamenti
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            Versione {Constants.expoConfig?.version ?? '?'}
            {Updates.updateId ? ` · update ${Updates.updateId.slice(0, 8)}` : ' · build base'}
          </ThemedText>
          <Pressable
            onPress={onCheckUpdates}
            disabled={checkingUpdate}
            style={({ pressed }) => [
              styles.secondaryButton,
              { backgroundColor: theme.backgroundElement },
              (pressed || checkingUpdate) && styles.pressed,
            ]}>
            <ThemedText type="small">Controlla aggiornamenti</ThemedText>
          </Pressable>
          {updateStatus && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {updateStatus}
            </ThemedText>
          )}
          <Pressable onPress={() => Linking.openURL(RELEASES_URL)}>
            <ThemedText type="linkPrimary" style={styles.centerText}>
              Scarica APK (GitHub Releases)
            </ThemedText>
          </Pressable>
        </ThemedView>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  container: {
    maxWidth: MaxContentWidth,
    flexGrow: 1,
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  errorText: {
    color: ERROR_COLOR,
    textAlign: 'center',
  },
  centerText: {
    textAlign: 'center',
  },
  saveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.five,
    minHeight: 52,
    backgroundColor: PRIMARY_COLOR,
  },
  saveButtonText: {
    color: '#ffffff',
    fontWeight: 700,
  },
  updatesSection: {
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.five,
  },
  pressed: {
    opacity: 0.7,
  },
});
