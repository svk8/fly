import React, { useState, useEffect } from 'react';
import { ConsumerApp } from './components/ConsumerApp';
import { InvestorSuite } from './components/InvestorSuite';

export default function App() {
  // 1. TELEGRAM RUNTIME DETECTION:
  // Detect standard Telegram Mini App environment across mobile, desktop and web clients
  const isTelegram = Boolean(
    typeof window !== 'undefined' && (
      (window as any).Telegram?.WebApp?.initData ||
      window.location.search.includes('tgWebAppData') ||
      window.location.hash.includes('tgWebAppData') ||
      window.location.search.includes('tgWebAppVersion') ||
      window.location.hash.includes('tgWebAppVersion') ||
      Boolean((window as any).TelegramWebviewProxy) ||
      ((window as any).Telegram?.WebApp?.platform && (window as any).Telegram?.WebApp?.platform !== 'unknown')
    )
  );

  // Mode for desktop browser testing only.
  // In Telegram runtime, mode is NEVER 'investor'.
  const [browserMode, setBrowserMode] = useState<'consumer' | 'investor'>(() => {
    if (typeof window !== 'undefined' && !isTelegram && window.location.search.includes('mode=investor')) {
      return 'investor';
    }
    return 'consumer';
  });

  useEffect(() => {
    // If inside Telegram WebApp, initialize, expand and adapt header/background colors
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      try {
        const tg = (window as any).Telegram.WebApp;
        tg.ready();
        tg.expand();
        if (typeof tg.setHeaderColor === 'function') {
          tg.setHeaderColor('#0f172a');
        }
        if (typeof tg.setBackgroundColor === 'function') {
          tg.setBackgroundColor('#020617');
        }
      } catch (e) {
        console.warn('Telegram WebApp initialization error:', e);
      }
    }
  }, []);

  // 2. STRICT TELEGRAM RUNTIME ISOLATION:
  // If running inside Telegram Mini App, strictly render ONLY the consumer mobile app.
  // Under NO circumstance can the user switch to or view the investor/developer suite.
  if (isTelegram) {
    return (
      <div className="w-full min-h-screen bg-slate-950 font-sans text-slate-100 select-none overflow-x-hidden">
        <ConsumerApp
          isTelegramWebApp={true}
          // Do not pass onSwitchToInvestor: investor/dev elements are completely omitted
        />
      </div>
    );
  }

  // 3. DESKTOP / BROWSER RUNTIME:
  // Dual-mode enabled for business angels, technical evaluation, and developer testing
  return (
    <div className="w-full min-h-screen bg-slate-950 font-sans text-slate-100 overflow-x-hidden">
      {browserMode === 'consumer' ? (
        <ConsumerApp
          isTelegramWebApp={false}
          onSwitchToInvestor={() => setBrowserMode('investor')}
        />
      ) : (
        <InvestorSuite
          onBackToConsumer={() => setBrowserMode('consumer')}
        />
      )}
    </div>
  );
}
