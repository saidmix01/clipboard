import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es.json';

// Extend window object to include copyfy
declare global {
  interface Window {
    copyfy: {
      getSystemLocale: () => Promise<string>;
    };
    electronAPI?: {
      getPreferences: () => Promise<any>;
    }
  }
}

const resources = {
  en: { translation: en },
  es: { translation: es },
};

export const initI18n = async () => {
  let language = 'en'; // Default fallback

  try {
    // 1. Check user preference
    // We try to get it from Electron preferences
    let userPref = null;
    if (window.electronAPI?.getPreferences) {
        try {
            const prefs = await window.electronAPI.getPreferences();
            if (prefs && prefs.language) {
                userPref = prefs.language;
            }
        } catch (e) {
            // Failed to get preferences for language
        }
    }

    if (userPref) {
      language = userPref;
    } else {
      // 2. Check system locale
      try {
          const systemLocale = await window.copyfy.getSystemLocale();
          if (systemLocale && systemLocale.toLowerCase().startsWith('es')) {
            language = 'es';
          } else {
            language = 'en';
          }
      } catch (e) {
          // Failed to get system locale
      }
    }
  } catch (error) {
    // Error detecting language
  }

  await i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: language,
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
    });
    
  return i18n;
};

export default i18n;
