import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary, initMonitoring } from './monitoring';
import './index.css';

async function start() {
  await initMonitoring();
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary fallback={<div role="alert" style={{padding:24}}>Не удалось открыть приложение. Обновите страницу.</div>}>
      <App />
    </ErrorBoundary>
  );
}
void start();
