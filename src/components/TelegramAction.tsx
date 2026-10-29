import type { ReactNode } from 'react';
import { botLink } from '../botLinks';

export function TelegramAction({isTelegram, botUrl, action, onClick, className, children}: {
  isTelegram: boolean; botUrl: string; action: string; onClick: () => void;
  className?: string; children: ReactNode;
}) {
  return isTelegram ? <button onClick={onClick} className={className}>{children}</button>
    : <a href={botLink(botUrl, action)} className={className}>{children}</a>;
}
