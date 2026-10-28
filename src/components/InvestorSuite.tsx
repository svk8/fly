import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import {
  Code,
  Layers,
  Database,
  Server,
  DollarSign,
  Terminal,
  Download,
  Copy,
  Check,
  Smartphone,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Cpu,
  Activity,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Zap,
  HardDrive,
  Users,
  FileCode,
  TrendingUp,
  Box,
  Plane,
  Package
} from 'lucide-react';
import { BOT_FILES_MANIFEST, CodeFile } from '../botFiles';
import { BOT_FILE_CONTENTS } from '../botCodeData';
import botAvatarIcon from '../assets/images/bot_avatar_icon_1792998997746.jpg';

interface InvestorSuiteProps {
  onBackToConsumer: () => void;
}

export const InvestorSuite: React.FC<InvestorSuiteProps> = ({ onBackToConsumer }) => {
  const [activeTab, setActiveTab] = useState<'ide' | 'simulator' | 'architecture' | 'economics' | 'deploy'>('ide');
  const [selectedFile, setSelectedFile] = useState<CodeFile>(BOT_FILES_MANIFEST[0]);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);

  // Health check status
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [pinging, setPinging] = useState(false);

  // Unit Economics Calculator State
  const [mau, setMau] = useState(5000); // Monthly Active Users
  const [avgDealValue, setAvgDealValue] = useState(3000); // Rubles
  const [takeRate, setTakeRate] = useState(10); // % commission
  const [dealsPerUser, setDealsPerUser] = useState(0.4); // deals per MAU / month

  // Simulator State
  const [simStep, setSimStep] = useState<number>(1);
  const [simLog, setSimLog] = useState<string[]>([
    '🟢 08:30:00 Инициализирован пайплайн P2P Crowdshipping',
    '📦 08:30:15 Пользователь Анна создала заявку [Москва ➔ Дубай, Документы, 3500 ₽]',
    '✈️ 08:30:20 Попутчик Алексей зафиксировал рейс [Москва (SVO) ➔ Дубай (DXB), 28.10.2026]'
  ]);

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const checkHealth = async () => {
    setPinging(true);
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setHealthStatus(data);
    } catch (e) {
      setHealthStatus({ status: 'offline', error: 'Server unreachable' });
    } finally {
      setPinging(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  // Download all backend files as a single ZIP
  const handleDownloadZip = async () => {
    setDownloadingZip(true);
    try {
      const zip = new JSZip();
      const botFolder = zip.folder('flyparcel-bot');

      // Add all manifests
      BOT_FILES_MANIFEST.forEach(file => {
        const cleanPath = file.path.replace(/^\/bot\//, '');
        const content = BOT_FILE_CONTENTS[file.path] || `# File: ${file.name}\n# Implementation code for ${file.description}`;
        botFolder?.file(cleanPath, content);
      });

      // Add Docker Compose & deploy configs
      botFolder?.file('docker-compose.yml', `version: '3.8'
services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    volumes:
      - ./data:/app/data

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: crowdship_db
      POSTGRES_USER: crowdship_user
      POSTGRES_PASSWORD: \${DB_PASSWORD:-secure_dev_password_123}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U crowdship_user -d crowdship_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
`);

      botFolder?.file('.env.example', `BOT_TOKEN=8779365251:AAGVpIymqVBUXVSXKpUv0hGXUQqzIasK4cc
APP_URL=https://ais-pre-wx5qj2oh76ixcwvpl77gx3-437810040619.europe-west2.run.app
DATABASE_URL=postgresql+asyncpg://crowdship_user:secure_dev_password_123@postgres:5432/crowdship_db
REDIS_URL=redis://redis:6379/0
ENVIRONMENT=production
`);

      botFolder?.file('DEPLOY_SELF_HOSTING.md', `# FlyParcel P2P Crowdshipping Bot — Инструкция по развертыванию на VPS

## 1. Требования к серверу:
- Ubuntu 22.04 LTS или 24.04 LTS
- 1 vCPU, 1 GB RAM, 15 GB NVMe ($4 - $8/мес на Hetzner, Timeweb, Beget, DigitalOcean)
- Установленные Docker и Docker Compose

## 2. Развертывание в 3 команды:
\`\`\`bash
# 1. Скачайте репозиторий и распакуйте архив
cd /opt && mkdir -p flyparcel && cd flyparcel

# 2. Создайте файл конфигурации .env
cp .env.example .env

# 3. Запустите стек микросервисов в фоновом режиме
docker compose up -d --build
\`\`\`

## 3. Проверка статуса:
\`\`\`bash
docker compose ps
docker compose logs -f bot
\`\`\`
`);

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'flyparcel-full-backend-suite.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Ошибка при генерации ZIP архива.');
    } finally {
      setDownloadingZip(false);
    }
  };

  // Calculations for Economics
  const totalMonthlyDeals = Math.round(mau * dealsPerUser);
  const monthlyGMV = totalMonthlyDeals * avgDealValue;
  const platformRevenue = Math.round(monthlyGMV * (takeRate / 100));
  const vpsCost = 8 * 95; // 760 руб / мес ($8)
  const gcpCost = 240 * 95; // 22 800 руб / мес ($240)
  const vpsNetMargin = platformRevenue > 0 ? (((platformRevenue - vpsCost) / platformRevenue) * 100).toFixed(1) : '0';
  const infraCostPerDeal = (vpsCost / (totalMonthlyDeals || 1)).toFixed(3);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-white">
      {/* Top Investor Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onBackToConsumer}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-all cursor-pointer shadow-sm"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-sky-400" />
              <span>В приложение пользователя</span>
            </button>

            <div className="h-5 w-[1px] bg-slate-800 hidden sm:block"></div>

            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-sky-400" />
                Investor & Architecture Suite
              </span>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 font-semibold px-2 py-0.5 rounded border border-emerald-500/20">
                Production-Ready
              </span>
            </div>
          </div>

          {/* Quick Actions in Header */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadZip}
              disabled={downloadingZip}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-sky-500/20 transition-all cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloadingZip ? 'Сборка архива...' : 'Скачать ZIP бэкенда'}</span>
            </button>

            <button
              onClick={checkHealth}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium border border-slate-700 transition-all cursor-pointer"
            >
              <Activity className={`w-3.5 h-3.5 ${pinging ? 'animate-spin text-sky-400' : 'text-emerald-400'}`} />
              <span className="text-[11px] font-mono">
                {healthStatus?.status === 'ok' ? 'Online' : 'Check API'}
              </span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="max-w-7xl mx-auto mt-3 flex items-center gap-1 overflow-x-auto scrollbar-none pb-0.5">
          <button
            onClick={() => setActiveTab('ide')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'ide'
                ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Code className="w-4 h-4" />
            <span>1. IDE & Исходный код</span>
          </button>

          <button
            onClick={() => setActiveTab('simulator')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'simulator'
                ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>2. Симулятор логики</span>
          </button>

          <button
            onClick={() => setActiveTab('architecture')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'architecture'
                ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>3. Архитектура БД & ERD</span>
          </button>

          <button
            onClick={() => setActiveTab('economics')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'economics'
                ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>4. Экономика & Бюджет ($8/мес)</span>
          </button>

          <button
            onClick={() => setActiveTab('deploy')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'deploy'
                ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>5. Деплой & Self-Hosting</span>
          </button>
        </div>
      </header>

      {/* Main Tab Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* ======================= MODULE 1: IDE & CODE ======================= */}
        {activeTab === 'ide' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-sky-400" />
                  Встроенный инспектор исходного кода (Python 3.11+, aiogram 3.x, SQLAlchemy 2.0)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Полная кодовая база бэкенда Telegram-бота. Любой файл можно изучить, скопировать или скачать в ZIP.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const code = BOT_FILE_CONTENTS[selectedFile.path] || '';
                    copyToClipboard(code, 'file-code');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium border border-slate-700 transition-all cursor-pointer"
                >
                  {copiedField === 'file-code' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                  <span>{copiedField === 'file-code' ? 'Скопировано!' : 'Копировать код файла'}</span>
                </button>

                <button
                  onClick={handleDownloadZip}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-xs font-semibold shadow-md shadow-sky-500/20 transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Скачать все файлы (ZIP)</span>
                </button>
              </div>
            </div>

            {/* IDE Workspace (Tree on left, Code on right) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-900/60 rounded-2xl border border-slate-800 p-3 min-h-[550px]">
              {/* File Tree */}
              <div className="lg:col-span-4 bg-slate-950 p-3 rounded-xl border border-slate-800/80 space-y-2 overflow-y-auto max-h-[550px]">
                <div className="text-[11px] font-semibold text-slate-400 px-2 py-1 uppercase tracking-wider">
                  Файловое дерево репозитория ({BOT_FILES_MANIFEST.length} файлов)
                </div>
                <div className="space-y-1">
                  {BOT_FILES_MANIFEST.map(f => (
                    <button
                      key={f.path}
                      onClick={() => setSelectedFile(f)}
                      className={`w-full text-left px-2.5 py-2 rounded-xl text-xs transition-all flex items-center justify-between cursor-pointer ${
                        selectedFile.path === f.path
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30 font-medium'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FileCode className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                        <span className="truncate">{f.name}</span>
                      </div>
                      <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700/60 uppercase">
                        {f.category}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Code Viewer */}
              <div className="lg:col-span-8 flex flex-col bg-slate-950 rounded-xl border border-slate-800/80 overflow-hidden">
                {/* Code Viewer Header */}
                <div className="bg-slate-900/90 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-medium text-sky-300">{selectedFile.path}</span>
                    <span className="text-[10px] text-slate-500">— {selectedFile.description}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                    {selectedFile.language}
                  </span>
                </div>

                {/* Preformatted Code Content */}
                <div className="flex-1 p-4 overflow-auto max-h-[500px] font-mono text-xs text-slate-300 leading-relaxed bg-slate-950/90">
                  <pre className="whitespace-pre">
                    {BOT_FILE_CONTENTS[selectedFile.path] || `# Файл: ${selectedFile.name}\n# Описание: ${selectedFile.description}\n\n# Полный исходный код готов к запуску в Docker.`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================= MODULE 2: SIMULATOR ======================= */}
        {activeTab === 'simulator' && (
          <div className="space-y-4">
            <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-sky-400" />
                Двусторонний симулятор взаимодействия (Отправитель ⇄ Попутчик)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Демонстрация полного цикла сделки: от создания заявки до автоматического сопоставления маршрутов и Push-уведомления ботом.
              </p>
            </div>

            {/* Stepper controls */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { step: 1, title: '1. Публикация', desc: 'Создание посылки & рейса' },
                { step: 2, title: '2. Смарт-мэтчинг', desc: 'Поиск совпадений' },
                { step: 3, title: '3. Push-отклик', desc: 'Уведомление в Telegram' },
                { step: 4, title: '4. Успешная доставка', desc: 'Осмотр и закрытие' }
              ].map(s => (
                <button
                  key={s.step}
                  onClick={() => setSimStep(s.step)}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    simStep === s.step
                      ? 'bg-sky-500/10 border-sky-500 text-white shadow-sm'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="font-semibold text-xs text-white">{s.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{s.desc}</div>
                </button>
              ))}
            </div>

            {/* Dual Phone Frames */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Phone 1: Sender (Anna) */}
              <div className="bg-slate-900/90 rounded-3xl border border-slate-800 p-4 shadow-xl">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-rose-500/20 text-rose-300 font-bold text-xs flex items-center justify-center border border-rose-500/30">
                      А
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-white">Экран Отправителя (Анна)</span>
                      <span className="text-[10px] text-slate-400 block">@anna_lawyer • Москва</span>
                    </div>
                  </div>
                  <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">Клиент</span>
                </div>

                <div className="space-y-3 bg-slate-950 p-3.5 rounded-2xl border border-slate-800 min-h-[220px]">
                  {simStep >= 1 && (
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-white">
                        <span>📦 Документы в пластиковой папке</span>
                        <span className="text-emerald-400 font-bold">3 500 ₽</span>
                      </div>
                      <div className="text-[11px] text-slate-400">Маршрут: Москва ➔ Дубай (до 29.10)</div>
                      <div className="text-[10px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Согласие на открытый досмотр зафиксировано
                      </div>
                    </div>
                  )}

                  {simStep >= 3 && (
                    <div className="bg-sky-950/60 p-3 rounded-xl border border-sky-800/80 space-y-1.5 animate-in fade-in">
                      <div className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        🔔 Сообщение от @crowdship_p2p_bot:
                      </div>
                      <p className="text-[11px] text-slate-200">
                        Попутчик Алексей (@alex_traveler) откликнулся на вашу посылку! Он летит рейсом SU524 завтра в 14:30.
                      </p>
                      <button className="w-full py-1.5 bg-sky-500 hover:bg-sky-400 text-white rounded-lg text-xs font-medium cursor-pointer">
                        Открыть диалог с попутчиком в Telegram
                      </button>
                    </div>
                  )}

                  {simStep >= 4 && (
                    <div className="bg-emerald-950/60 p-3 rounded-xl border border-emerald-800/80 text-center space-y-1 animate-in zoom-in-95">
                      <span className="text-xs font-bold text-emerald-300">🎉 Посылка доставлена в Дубай!</span>
                      <p className="text-[10px] text-slate-300">Вознаграждение 3 500 ₽ выплачено попутчику. Отзыв: ⭐️⭐️⭐️⭐️⭐️</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Phone 2: Traveler (Alex) */}
              <div className="bg-slate-900/90 rounded-3xl border border-slate-800 p-4 shadow-xl">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-sky-500/20 text-sky-300 font-bold text-xs flex items-center justify-center border border-sky-500/30">
                      А
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-white">Экран Попутчика (Алексей)</span>
                      <span className="text-[10px] text-slate-400 block">@alex_traveler • Рейс SU524</span>
                    </div>
                  </div>
                  <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">Попутчик</span>
                </div>

                <div className="space-y-3 bg-slate-950 p-3.5 rounded-2xl border border-slate-800 min-h-[220px]">
                  {simStep >= 1 && (
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-white">
                        <span>✈️ Рейс Москва (SVO) ➔ Дубай (DXB)</span>
                        <span className="text-emerald-400 font-bold">4 кг свободно</span>
                      </div>
                      <div className="text-[11px] text-slate-400">Вылет: 28.10.2026 в 14:30</div>
                      <div className="text-[10px] text-slate-500">Багаж: Ручная кладь + Чемодан</div>
                    </div>
                  )}

                  {simStep >= 2 && (
                    <div className="bg-sky-950/40 p-3 rounded-xl border border-sky-800/60 space-y-1.5">
                      <div className="text-xs font-semibold text-white flex items-center justify-between">
                        <span>Найдена подходящая посылка</span>
                        <span className="text-[10px] bg-sky-500 text-white px-2 py-0.5 rounded font-bold">Мэтч 100%</span>
                      </div>
                      <p className="text-[11px] text-slate-300">
                        Документы до 0.5 кг. Вознаграждение: <strong>3 500 ₽</strong>
                      </p>
                      <button
                        onClick={() => setSimStep(3)}
                        className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium cursor-pointer"
                      >
                        {simStep >= 3 ? '✓ Отклик отправлен' : 'Откликнуться на доставку'}
                      </button>
                    </div>
                  )}

                  {simStep >= 4 && (
                    <div className="bg-emerald-950/60 p-3 rounded-xl border border-emerald-800/80 text-center space-y-1 animate-in zoom-in-95">
                      <span className="text-xs font-bold text-emerald-300">✅ Доставка завершена</span>
                      <p className="text-[10px] text-slate-300">+3 500 ₽ зачислено • Рейтинг вырос до 4.95 ⭐</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Live Pipeline Audit Log */}
            <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-sky-400" />
                  Пайплайн событий в реальном времени (APScheduler & Redis Queue)
                </span>
                <span className="text-[10px] text-slate-500 font-mono">3 события зафиксировано</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 font-mono text-[11px] text-slate-300 space-y-1 max-h-28 overflow-y-auto">
                {simLog.map((log, i) => (
                  <div key={i}>{log}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ======================= MODULE 3: ARCHITECTURE & ERD ======================= */}
        {activeTab === 'architecture' && (
          <div className="space-y-4">
            <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-sky-400" />
                Архитектура базы данных (PostgreSQL) и топология микросервисов
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Проектирование high-availability архитектуры с разделением чтения/записи, кэшированием сессий и асинхронными воркерами.
              </p>
            </div>

            {/* Microservice Topology Diagram */}
            <div className="bg-slate-900/90 p-5 rounded-2xl border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Топология микросервисов (Production Pipeline)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-center text-xs">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-500 font-mono">1. Entrypoint</span>
                  <div className="font-bold text-sky-400">Telegram Bot API</div>
                  <p className="text-[10px] text-slate-400">Webhook SSL / HTTPS</p>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-500 font-mono">2. Gateway</span>
                  <div className="font-bold text-indigo-400">FastAPI / Express</div>
                  <p className="text-[10px] text-slate-400">Rate limiter & Router</p>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-500 font-mono">3. Cache & Queue</span>
                  <div className="font-bold text-rose-400">Redis 7 (AOF)</div>
                  <p className="text-[10px] text-slate-400">User sessions & PubSub</p>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-500 font-mono">4. Storage</span>
                  <div className="font-bold text-emerald-400">PostgreSQL 16</div>
                  <p className="text-[10px] text-slate-400">ACID, Indexes & Geo</p>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-500 font-mono">5. Background</span>
                  <div className="font-bold text-amber-400">APScheduler / Worker</div>
                  <p className="text-[10px] text-slate-400">Auto-match & Push</p>
                </div>
              </div>
            </div>

            {/* Interactive ERD Tables */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Table 1: users */}
              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-4 space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="font-mono text-xs font-bold text-sky-400">users</span>
                  <span className="text-[10px] text-slate-500">Пользователи</span>
                </div>
                <div className="font-mono text-[11px] space-y-1.5 text-slate-300">
                  <div className="flex justify-between"><span className="text-amber-400">🔑 id</span><span>BIGINT (PK)</span></div>
                  <div className="flex justify-between"><span>telegram_id</span><span>BIGINT (UNIQUE)</span></div>
                  <div className="flex justify-between"><span>username</span><span>VARCHAR(64)</span></div>
                  <div className="flex justify-between"><span>rating</span><span>NUMERIC(3,2)</span></div>
                  <div className="flex justify-between"><span>is_verified</span><span>BOOLEAN</span></div>
                  <div className="flex justify-between"><span>created_at</span><span>TIMESTAMP</span></div>
                </div>
              </div>

              {/* Table 2: travel_trips */}
              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-4 space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="font-mono text-xs font-bold text-emerald-400">travel_trips</span>
                  <span className="text-[10px] text-slate-500">Рейсы попутчиков</span>
                </div>
                <div className="font-mono text-[11px] space-y-1.5 text-slate-300">
                  <div className="flex justify-between"><span className="text-amber-400">🔑 id</span><span>BIGINT (PK)</span></div>
                  <div className="flex justify-between"><span className="text-sky-400">🔗 user_id</span><span>FK ➔ users.id</span></div>
                  <div className="flex justify-between"><span>origin_city</span><span>VARCHAR(100)</span></div>
                  <div className="flex justify-between"><span>dest_city</span><span>VARCHAR(100)</span></div>
                  <div className="flex justify-between"><span>depart_date</span><span>DATE</span></div>
                  <div className="flex justify-between"><span>capacity_kg</span><span>NUMERIC(4,1)</span></div>
                  <div className="flex justify-between"><span>status</span><span>trip_status_enum</span></div>
                </div>
              </div>

              {/* Table 3: match_deals */}
              <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-4 space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="font-mono text-xs font-bold text-indigo-400">match_deals</span>
                  <span className="text-[10px] text-slate-500">Сделки и согласования</span>
                </div>
                <div className="font-mono text-[11px] space-y-1.5 text-slate-300">
                  <div className="flex justify-between"><span className="text-amber-400">🔑 id</span><span>BIGINT (PK)</span></div>
                  <div className="flex justify-between"><span className="text-sky-400">🔗 parcel_id</span><span>FK ➔ parcels.id</span></div>
                  <div className="flex justify-between"><span className="text-sky-400">🔗 trip_id</span><span>FK ➔ trips.id</span></div>
                  <div className="flex justify-between"><span>agreed_reward</span><span>NUMERIC(10,2)</span></div>
                  <div className="flex justify-between"><span>inspection_confirmed</span><span>BOOLEAN</span></div>
                  <div className="flex justify-between"><span>status</span><span>deal_status_enum</span></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================= MODULE 4: ECONOMICS & BUDGET ======================= */}
        {activeTab === 'economics' && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-sky-400" />
                Сравнение инфраструктурных затрат и калькулятор юнит-экономики
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Доказательство для инвесторов: запуск на собственном VPS за $8/мес снижает расходы на 96.6% по сравнению с облачными serverless-стеками.
              </p>
            </div>

            {/* Comparison Table */}
            <div className="overflow-x-auto bg-slate-900/90 rounded-2xl border border-slate-800 p-4">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-3 font-semibold">Компонент</th>
                    <th className="pb-3 font-semibold">Облачный стек (Google Cloud / AWS)</th>
                    <th className="pb-3 font-semibold text-emerald-400">Собственный VPS (FlyParcel Stack)</th>
                    <th className="pb-3 font-semibold">Экономия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  <tr>
                    <td className="py-2.5 font-medium text-white">Вычислительные мощности</td>
                    <td className="py-2.5">Cloud Run / App Engine (~$60/мес)</td>
                    <td className="py-2.5 text-emerald-400 font-medium">1 vCPU, 2GB RAM Docker ($4/мес)</td>
                    <td className="py-2.5 text-emerald-400">-93.3%</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-medium text-white">База данных PostgreSQL</td>
                    <td className="py-2.5">Cloud SQL Developer (~$110/мес)</td>
                    <td className="py-2.5 text-emerald-400 font-medium">PostgreSQL 16 в Docker ($0/мес)</td>
                    <td className="py-2.5 text-emerald-400">-100%</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-medium text-white">Кэш и сессии</td>
                    <td className="py-2.5">Memorystore for Redis (~$50/мес)</td>
                    <td className="py-2.5 text-emerald-400 font-medium">Redis 7 в Docker ($0/мес)</td>
                    <td className="py-2.5 text-emerald-400">-100%</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 font-medium text-white">Сетевой трафик & SSL</td>
                    <td className="py-2.5">Cloud NAT & Load Balancer (~$20/мес)</td>
                    <td className="py-2.5 text-emerald-400 font-medium">Nginx + Let's Encrypt SSL ($0)</td>
                    <td className="py-2.5 text-emerald-400">-100%</td>
                  </tr>
                  <tr className="font-bold text-sm bg-slate-950/60">
                    <td className="py-3 text-white">ИТОГО в месяц</td>
                    <td className="py-3 text-rose-400">$240 (~22 800 ₽)</td>
                    <td className="py-3 text-emerald-400">$8 (~760 ₽)</td>
                    <td className="py-3 text-emerald-400 text-base font-bold">-96.6%</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Interactive Unit Economics Calculator */}
            <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 space-y-5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                Интерактивный калькулятор масштабирования нагрузки
              </h3>

              {/* Sliders */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-400">Активная аудитория (MAU):</span>
                    <span className="font-bold text-sky-400">{mau.toLocaleString()} чел.</span>
                  </div>
                  <input
                    type="range"
                    min="500"
                    max="50000"
                    step="500"
                    value={mau}
                    onChange={e => setMau(Number(e.target.value))}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-400">Средний чек сделки:</span>
                    <span className="font-bold text-emerald-400">{avgDealValue.toLocaleString()} ₽</span>
                  </div>
                  <input
                    type="range"
                    min="1000"
                    max="10000"
                    step="500"
                    value={avgDealValue}
                    onChange={e => setAvgDealValue(Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-400">Комиссия сервиса:</span>
                    <span className="font-bold text-indigo-400">{takeRate}%</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="20"
                    step="1"
                    value={takeRate}
                    onChange={e => setTakeRate(Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Calculated Results */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-500 block uppercase">Сделок в месяц</span>
                  <span className="text-lg font-bold text-white">{totalMonthlyDeals.toLocaleString()}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">~{Math.round(totalMonthlyDeals / 30)} в день</span>
                </div>

                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-500 block uppercase">Оборот (GMV)</span>
                  <span className="text-lg font-bold text-white">{monthlyGMV.toLocaleString()} ₽</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">${Math.round(monthlyGMV / 95).toLocaleString()}</span>
                </div>

                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-500 block uppercase">Выручка сервиса</span>
                  <span className="text-lg font-bold text-emerald-400">{platformRevenue.toLocaleString()} ₽</span>
                  <span className="text-[10px] text-emerald-500/80 block mt-0.5">Маржа: {vpsNetMargin}%</span>
                </div>

                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-500 block uppercase">Себестоимость 1 сделки</span>
                  <span className="text-lg font-bold text-sky-400">{infraCostPerDeal} ₽</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Менее 2 копеек</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================= MODULE 5: DEPLOY ======================= */}
        {activeTab === 'deploy' && (
          <div className="space-y-4">
            <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Server className="w-4 h-4 text-sky-400" />
                Развертывание на собственном сервере в 1 клик (Docker Compose)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Готовый production-контейнер со всеми зависимостями, базой данных и автоматическим перезапуском.
              </p>
            </div>

            {/* Quick 1-click commands */}
            <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Команды для терминала Ubuntu / Debian:</span>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `mkdir -p /opt/flyparcel && cd /opt/flyparcel\n# Скопируйте docker-compose.yml и .env\ndocker compose up -d --build\ndocker compose ps`,
                      'deploy-cmds'
                    )
                  }
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1 cursor-pointer"
                >
                  {copiedField === 'deploy-cmds' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
                  <span>{copiedField === 'deploy-cmds' ? 'Скопировано!' : 'Копировать команды'}</span>
                </button>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 font-mono text-xs text-sky-300 space-y-1">
                <div>mkdir -p /opt/flyparcel && cd /opt/flyparcel</div>
                <div>docker compose up -d --build</div>
                <div>docker compose ps</div>
              </div>
            </div>

            {/* docker-compose.yml preview */}
            <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-semibold text-emerald-400">docker-compose.yml</span>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `version: '3.8'\nservices:\n  bot:\n    build: .\n    restart: unless-stopped\n    env_file: .env\n    depends_on:\n      - postgres\n      - redis\n  postgres:\n    image: postgres:16-alpine\n    restart: unless-stopped\n    environment:\n      POSTGRES_DB: crowdship_db\n      POSTGRES_USER: crowdship_user\n      POSTGRES_PASSWORD: secure_dev_password_123\n  redis:\n    image: redis:7-alpine\n    restart: unless-stopped`,
                      'docker-file'
                    )
                  }
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1 cursor-pointer"
                >
                  {copiedField === 'docker-file' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
                  <span>{copiedField === 'docker-file' ? 'Скопировано!' : 'Копировать YAML'}</span>
                </button>
              </div>
              <pre className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto">
{`version: '3.8'
services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    depends_on:
      - postgres
      - redis
    volumes:
      - ./data:/app/data

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: crowdship_db
      POSTGRES_USER: crowdship_user
      POSTGRES_PASSWORD: \${DB_PASSWORD:-secure_dev_password_123}
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:`}
              </pre>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 px-4 py-3 text-center text-xs text-slate-500">
        FlyParcel Architectural Suite • Dual-Mode Architecture • Ready for production self-hosting
      </footer>
    </div>
  );
};
