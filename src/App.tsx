import { useEffect } from 'react';
import { ConsumerApp } from './components/ConsumerApp';

export default function App() {
  const tg = (window as any).Telegram?.WebApp;
  useEffect(() => {
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor?.('#0f172a');
    tg?.setBackgroundColor?.('#020617');
  }, []);
  return <ConsumerApp isTelegramWebApp={Boolean(tg?.initData)} />;
}
