import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_TOKEN = process.env.BOT_TOKEN || '8779365251:AAGVpIymqVBUXVSXKpUv0hGXUQqzIasK4cc';
const APP_URL = process.env.APP_URL || 'https://ais-pre-wx5qj2oh76ixcwvpl77gx3-437810040619.europe-west2.run.app';

async function start() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json());

  // Shared In-Memory Data Store for P2P Crowdshipping (Shared across all chat users)
  let trips = [
    {
      id: 1,
      userId: 101,
      userName: 'Алексей Смирнов',
      userHandle: 'alex_traveler',
      userRating: 4.9,
      completedTrips: 14,
      fromCity: 'Москва (SVO)',
      toCity: 'Дубай (DXB)',
      departureDate: '28.10.2026',
      capacity: 'до 4 кг',
      reward: '1 500 ₽/кг',
      note: 'Рейс Аэрофлот в 14:30. Могу забрать посылку у терминала C или в центре Москвы.',
      status: 'active',
      createdAt: new Date().toISOString()
    },
    {
      id: 2,
      userId: 102,
      userName: 'Елена Васильева',
      userHandle: 'elena_fly',
      userRating: 5.0,
      completedTrips: 9,
      fromCity: 'Стамбул (IST)',
      toCity: 'Москва (VKO)',
      departureDate: '30.10.2026',
      capacity: 'до 3 кг',
      reward: '1 800 ₽/кг',
      note: 'Лечу Turkish Airlines. Посылки только в открытом виде для досмотра.',
      status: 'active',
      createdAt: new Date().toISOString()
    },
    {
      id: 3,
      userId: 103,
      userName: 'Азамат Бакиров',
      userHandle: 'azamat_express',
      userRating: 4.8,
      completedTrips: 22,
      fromCity: 'Бишкек (FRU)',
      toCity: 'Москва (DME)',
      departureDate: '29.10.2026',
      capacity: 'до 8 кг',
      reward: '1 200 ₽/кг',
      note: 'Регулярные рейсы. Документы, одежда, покупки.',
      status: 'active',
      createdAt: new Date().toISOString()
    },
    {
      id: 4,
      userId: 104,
      userName: 'Шерзод Усманов',
      userHandle: 'sherzod_travel',
      userRating: 4.9,
      completedTrips: 11,
      fromCity: 'Ташкент (TAS)',
      toCity: 'Санкт-Петербург (LED)',
      departureDate: '02.11.2026',
      capacity: 'до 5 кг',
      reward: '1 400 ₽/кг',
      note: 'Прямой рейс Uzbekistan Airways. Свободное место в чемодане.',
      status: 'active',
      createdAt: new Date().toISOString()
    }
  ];

  let parcels = [
    {
      id: 1,
      senderId: 201,
      senderName: 'Анна Морозова',
      senderHandle: 'anna_lawyer',
      senderRating: 5.0,
      fromCity: 'Москва',
      toCity: 'Дубай',
      deadlineDate: '29.10.2026',
      category: 'Документы',
      weight: '0.4 кг',
      description: 'Срочные договоры и доверенности в пластиковой папке (покажу в открытом виде).',
      budget: 3500,
      currency: '₽',
      status: 'searching',
      createdAt: new Date().toISOString()
    },
    {
      id: 2,
      senderId: 202,
      senderName: 'Дмитрий Волков',
      senderHandle: 'dmitry_v',
      senderRating: 4.9,
      fromCity: 'Стамбул',
      toCity: 'Москва',
      deadlineDate: '31.10.2026',
      category: 'Одежда & Покупки',
      weight: '2.5 кг',
      description: 'Детская куртка и две пары обуви из торгового центра. Чеки и бирки сохранены.',
      budget: 4500,
      currency: '₽',
      status: 'searching',
      createdAt: new Date().toISOString()
    },
    {
      id: 3,
      senderId: 203,
      senderName: 'Тимур Алиев',
      senderHandle: 'timur_dev',
      senderRating: 4.7,
      fromCity: 'Бишкек',
      toCity: 'Москва',
      deadlineDate: '30.10.2026',
      category: 'Электроника',
      weight: '1.1 кг',
      description: 'Новый блок питания и клавиатура для MacBook (в заводской открытой упаковке).',
      budget: 3000,
      currency: '₽',
      status: 'searching',
      createdAt: new Date().toISOString()
    }
  ];

  let deals: any[] = [
    {
      id: 1,
      parcelId: 1,
      tripId: 1,
      senderName: 'Анна Морозова',
      senderHandle: 'anna_lawyer',
      travelerName: 'Алексей Смирнов',
      travelerHandle: 'alex_traveler',
      route: 'Москва ➔ Дубай',
      reward: '3 500 ₽',
      category: 'Документы',
      status: 'matched', // 'matched' | 'confirmed' | 'in_transit' | 'delivered'
      inspectionDone: true,
      createdAt: new Date().toISOString()
    }
  ];

  // API Endpoints for Consumer & Investor modes
  app.get('/api/trips', (req, res) => {
    res.json({ trips });
  });

  app.post('/api/trips', (req, res) => {
    const { userName, userHandle, fromCity, toCity, departureDate, capacity, reward, note } = req.body;
    if (!fromCity || !toCity) {
      return res.status(400).json({ error: 'Cities are required' });
    }
    const newTrip = {
      id: Date.now(),
      userId: Math.floor(Math.random() * 1000) + 300,
      userName: userName || 'Попутчик FlyParcel',
      userHandle: userHandle ? userHandle.replace('@', '') : 'user',
      userRating: 5.0,
      completedTrips: 1,
      fromCity,
      toCity,
      departureDate: departureDate || 'Ближайшие дни',
      capacity: capacity || 'до 3 кг',
      reward: reward || '1 500 ₽/кг',
      note: note || 'Готов взять посылку в открытом виде.',
      status: 'active',
      createdAt: new Date().toISOString()
    };
    trips.unshift(newTrip);
    res.status(201).json({ trip: newTrip });
  });

  app.get('/api/parcels', (req, res) => {
    res.json({ parcels });
  });

  app.post('/api/parcels', (req, res) => {
    const { senderName, senderHandle, fromCity, toCity, deadlineDate, category, weight, description, budget } = req.body;
    if (!fromCity || !toCity) {
      return res.status(400).json({ error: 'Cities are required' });
    }
    const newParcel = {
      id: Date.now(),
      senderId: Math.floor(Math.random() * 1000) + 500,
      senderName: senderName || 'Отправитель FlyParcel',
      senderHandle: senderHandle ? senderHandle.replace('@', '') : 'user',
      senderRating: 5.0,
      fromCity,
      toCity,
      deadlineDate: deadlineDate || 'Срочно',
      category: category || 'Посылка',
      weight: weight || 'до 1 кг',
      description: description || 'Передача в открытом виде для досмотра.',
      budget: Number(budget) || 2000,
      currency: '₽',
      status: 'searching',
      createdAt: new Date().toISOString()
    };
    parcels.unshift(newParcel);
    res.status(201).json({ parcel: newParcel });
  });

  app.get('/api/deals', (req, res) => {
    res.json({ deals });
  });

  app.post('/api/deals', (req, res) => {
    const { parcelId, tripId, senderName, senderHandle, travelerName, travelerHandle, route, reward, category } = req.body;
    const newDeal = {
      id: Date.now(),
      parcelId,
      tripId,
      senderName: senderName || 'Отправитель',
      senderHandle: (senderHandle || '').replace('@', ''),
      travelerName: travelerName || 'Попутчик',
      travelerHandle: (travelerHandle || '').replace('@', ''),
      route: route || 'Маршрут доставки',
      reward: reward || 'Договорная',
      category: category || 'Посылка',
      status: 'matched',
      inspectionDone: true,
      createdAt: new Date().toISOString()
    };
    deals.unshift(newDeal);
    res.status(201).json({ deal: newDeal });
  });

  app.post('/api/deals/:id/status', (req, res) => {
    const dealId = Number(req.params.id);
    const { status } = req.body;
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    deal.status = status;
    res.json({ deal });
  });

  // Deal Notification Endpoint (Push to Telegram chat if chat ID available)
  app.post('/api/notify-deal', async (req, res) => {
    const { chatId, message } = req.body;
    if (chatId) {
      await sendTelegramMessage(
        chatId,
        `🔔 **FlyParcel Уведомление:**\n\n${message || 'Новый отклик по вашей заявке!'}`,
        {
          inline_keyboard: [
            [
              {
                text: '🚀 Открыть сделку в Mini App',
                web_app: { url: APP_URL }
              }
            ]
          ]
        }
      );
    }
    res.json({ success: true, delivered: Boolean(chatId) });
  });

  // Webhook status & healthcheck
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      bot: '@crowdship_p2p_bot',
      appUrl: APP_URL,
      tripsCount: trips.length,
      parcelsCount: parcels.length,
      dealsCount: deals.length,
      timestamp: new Date().toISOString()
    });
  });

  // Telegram Webhook Handler
  app.post('/api/telegram/webhook', async (req, res) => {
    // Instantly acknowledge receipt to Telegram
    res.sendStatus(200);

    const update = req.body;
    if (!update) return;

    try {
      if (update.message && update.message.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text.trim();
        const firstName = update.message.from?.first_name || 'друг';

        if (text.startsWith('/start')) {
          await sendTelegramMessage(
            chatId,
            `👋 Привет, ${firstName}!\n\n` +
              `Добро пожаловать в **FlyParcel** — сервис P2P-доставки посылок и документов через путешественников ✈️📦\n\n` +
              `🔹 **Вы летите?** Возьмите посылку попутно и заработайте от 2 000 до 15 000 руб.\n` +
              `🔹 **Нужно отправить?** Найдите проверенного попутчика на нужную дату.\n\n` +
              `🛡 **Безопасность:** все посылки передаются строго в открытом виде для досмотра.\n\n` +
              `👇 Нажмите кнопку ниже, чтобы открыть сервис:`,
            {
              inline_keyboard: [
                [
                  {
                    text: '🚀 Открыть FlyParcel (Mini App)',
                    web_app: { url: APP_URL }
                  }
                ],
                [
                  {
                    text: '✈️ Я лечу (Рейс)',
                    web_app: { url: `${APP_URL}?tab=traveler` }
                  },
                  {
                    text: '📦 Передать (Посылка)',
                    web_app: { url: `${APP_URL}?tab=sender` }
                  }
                ],
                [
                  {
                    text: '🛡 Правила безопасности',
                    callback_data: 'cmd_rules'
                  }
                ]
              ]
            }
          );
        } else if (text.startsWith('/rules')) {
          await sendTelegramMessage(
            chatId,
            `🛡 **ПРАВИЛА БЕЗОПАСНОСТИ FLYPARCEL**\n\n` +
              `1. **Обязательный досмотр:** Посылки передаются строго в открытом виде перед передачей, чтобы путешественник лично убедился в отсутствии запрещенных предметов.\n` +
              `2. **Категорически запрещено:** Лекарства без оригинального рецепта, скоропортящиеся продукты, жидкости без маркировки, горючие, ядовитые и взрывоопасные вещества, оружие.\n` +
              `3. **Согласование:** Все детали и сумма вознаграждения фиксируются перед вылетом.\n` +
              `4. **Защита данных:** Личные номера телефонов не раскрываются — общение происходит безопасно в Telegram.`,
            {
              inline_keyboard: [
                [
                  {
                    text: '🚀 Открыть приложение',
                    web_app: { url: APP_URL }
                  }
                ]
              ]
            }
          );
        } else if (text.startsWith('/support')) {
          await sendTelegramMessage(
            chatId,
            `💬 **Служба поддержки FlyParcel**\n\n` +
              `По всем вопросам работы бота, верификации и обратной связи пишите нам:\n` +
              `📩 Email: support@flyparcel.app\n` +
              `✈️ Мы на связи 24/7.`,
            {
              inline_keyboard: [
                [
                  {
                    text: '🚀 Открыть Mini App',
                    web_app: { url: APP_URL }
                  }
                ]
              ]
            }
          );
        } else {
          // General message fallback
          await sendTelegramMessage(
            chatId,
            `Привет! Чтобы найти попутчика или передать посылку, откройте наше приложение по кнопке ниже:`,
            {
              inline_keyboard: [
                [
                  {
                    text: '🚀 Открыть FlyParcel (Mini App)',
                    web_app: { url: APP_URL }
                  }
                ]
              ]
            }
          );
        }
      } else if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message?.chat.id;
        const data = query.data;

        if (chatId && data === 'cmd_rules') {
          await sendTelegramMessage(
            chatId,
            `🛡 **ПРАВИЛА БЕЗОПАСНОСТИ FLYPARCEL**\n\n` +
              `1. **Обязательный досмотр:** Посылки передаются строго в открытом виде.\n` +
              `2. **Категорически запрещено:** Любые запрещенные авиационными правилами IATA вещества.\n` +
              `3. **Прямой контакт:** Безопасное общение через Telegram без спама.`,
            {
              inline_keyboard: [
                [
                  {
                    text: '🚀 Открыть приложение',
                    web_app: { url: APP_URL }
                  }
                ]
              ]
            }
          );
        }
      }
    } catch (err) {
      console.error('Error handling Telegram webhook update:', err);
    }
  });

  // Helper to send messages via Telegram Bot API
  async function sendTelegramMessage(chatId: number | string, text: string, replyMarkup?: any) {
    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error('Error sending Telegram message:', e);
    }
  }

  // Register Webhook on startup
  async function registerWebhook() {
    try {
      const webhookEndpoint = `${APP_URL}/api/telegram/webhook`;
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookEndpoint,
          drop_pending_updates: true
        })
      });
      const data = await res.json();
      console.log('Telegram Webhook registration result:', data, 'Endpoint:', webhookEndpoint);
    } catch (e) {
      console.error('Failed to register Telegram webhook:', e);
    }
  }

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server listening on port ${PORT}`);
    await registerWebhook();
  });
}

start().catch(console.error);
