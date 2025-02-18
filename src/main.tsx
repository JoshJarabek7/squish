import React, { useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from './components/ui/theme-provider';
import {
  BrowserRouter,
  Route,
  Routes,
  Navigate,
  useNavigate,
} from 'react-router';
import Welcome from './routes/Welcome';
import Playground from './routes/Playground';
import { initDatabase, getSettings } from './lib/db';
import Database from '@tauri-apps/plugin-sql';
import { Toaster } from 'sonner';
import { useState, useEffect } from 'react';

// Create a context for triggering settings refresh
export const SettingsContext = React.createContext({
  refreshSettings: () => {},
});

// Routes component to handle navigation
function AppRoutes() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [hasValidSettings, setHasValidSettings] = useState<boolean | null>(
    null
  );
  const [isInitialized, setIsInitialized] = useState(false);
  const initializationPromise = useRef<Promise<Database | null> | null>(null);

  const refreshSettings = () => {
    if (!isInitialized) return;
    checkSettings();
  };

  // Handle database initialization
  useEffect(() => {
    async function initDb() {
      if (initializationPromise.current) {
        try {
          await initializationPromise.current;
          setIsInitialized(true);
        } catch (error) {
          console.error('Failed to initialize database:', error);
          initializationPromise.current = null;
        }
        return;
      }

      try {
        console.log('Starting database initialization...');
        initializationPromise.current = initDatabase();
        await initializationPromise.current;
        setIsInitialized(true);
      } catch (error) {
        console.error('Failed to initialize database:', error);
        initializationPromise.current = null;
      }
    }

    initDb();
  }, []);

  // Handle settings and routing
  const checkSettings = async () => {
    if (!isInitialized) return;

    try {
      setIsLoading(true);
      const settings = await getSettings();
      console.log('Current settings:', settings);

      const valid =
        settings !== null &&
        (settings.localHosted ||
          (settings.runpodApiKey && settings.runpodInstanceId));
      console.log('Has valid settings:', valid);

      setHasValidSettings(Boolean(valid));

      // Navigate based on settings
      if (valid) {
        navigate('/', { replace: true });
      } else {
        navigate('/welcome', { replace: true });
      }
    } catch (error) {
      console.error('Failed to check settings:', error);
      setHasValidSettings(false);
      navigate('/welcome', { replace: true });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isInitialized) {
      checkSettings();
    }
  }, [isInitialized]);

  if (isLoading || hasValidSettings === null) {
    return <div>Loading...</div>;
  }

  return (
    <SettingsContext.Provider value={{ refreshSettings }}>
      <Routes>
        <Route path='/welcome' element={<Welcome />} />
        <Route
          path='/'
          element={
            hasValidSettings ? (
              <Playground />
            ) : (
              <Navigate to='/welcome' replace />
            )
          }
        />
      </Routes>
    </SettingsContext.Provider>
  );
}

// App component for initialization
function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

// Render the app
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
      <App />
      <Toaster richColors position='bottom-center' />
    </ThemeProvider>
  </React.StrictMode>
);
