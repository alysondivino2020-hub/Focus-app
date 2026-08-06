import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.focus.app',
  appName: 'FOCUS',
  webDir: 'www',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https'
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_focus',
      iconColor: '#4F46E5',
      sound: 'focus_reminder.wav'
    }
  }
};

export default config;
