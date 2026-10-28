# 📦 Crowdshipping Marketplace — Telegram Bot (P2P Посылки и Документы)

Полнофункциональный, готовый к продакшен-деплою Telegram-бот для P2P-доставки посылок и документов через путешественников (попутчиков), написанный на **Python 3.11+**, **aiogram 3.x**, **SQLAlchemy 2.0 (Async)** и **APScheduler**.

---

## 🌟 Ключевые возможности

1. **Безопасность и регламент досмотра посылок:**
   - Обязательное интерактивное принятие дисклеймера безопасности при `/start`.
   - Запрет на передачу запечатанных/непрозрачных коробок без личного визуального досмотра попутчиком перед посадкой.
   - Разъяснение списков запрещенных грузов.
2. **Ролевая модель:**
   - `✈️ Попутчик (Я лечу)` — добавление рейсов, указание габаритов (документы, рюкзак, чемодан) и желаемого вознаграждения.
   - `📦 Отправитель (Мне нужно передать)` — регистрация посылки с фото, категорией, сроком и бюджетом.
   - `🔄 Совмещение ролей` с быстрым переключением в профиле.
3. **Умный Авто-Мэтчинг:**
   - При создании заявки отправителем алгоритм мгновенно находит в базе попутчиков с совпадающими городами и пересекающимися датами.
   - Мгновенные Push-уведомления попутчику с интерактивной кнопкой `🤝 Откликнуться на заявку`.
4. **Безопасный первый контакт:**
   - Телефонные номера пользователей **не раскрываются** третьим лицам.
   - Бот генерирует защищенную ссылку на диалог в Telegram (@username или tg://user?id=...) с инструкцией по безопасной передаче.
5. **Фоновый планировщик (APScheduler):**
   - Автоматическая архивация рейсов и заявок с истекшим сроком каждый день.

---

## 🛠️ Стек технологий

- **Язык:** Python 3.11+
- **Фреймворк:** `aiogram` 3.13+ (современный асинхронный фреймворк с поддержкой Router, FSM, Filters)
- **ORM / База данных:** `SQLAlchemy` 2.0 (asyncio) + `asyncpg` (PostgreSQL) / `aiosqlite` (SQLite)
- **Фоновые задачи:** `APScheduler` 3.10+
- **Валидация конфигурации:** `Pydantic` 2.x + `pydantic-settings`
- **Контейнеризация:** Docker & Docker Compose

---

## 🚀 Быстрый старт и настройка

### Шаг 1. Создание бота в @BotFather

1. Откройте диалог с официальным ботом в Telegram: [@BotFather](https://t.me/BotFather).
2. Отправьте команду: `/newbot`.
3. Задайте имя бота (например: `CrowdShip P2P Express`).
4. Задайте уникальный username (например: `crowdship_delivery_bot`).
5. Скопируйте полученный **API Token** (вида `7123456789:ABCdefGhIJ...`).
6. Настройте команды бота через `/setcommands`:
   ```text
   start - 🚀 Главное меню и перезапуск
   profile - 👤 Мой профиль и смена роли
   rules - 🛡️ Правила безопасности и досмотра
   ```
7. **Подключение Telegram Mini App (TMA):**
   - Чтобы в левом нижнем углу чата появилась кнопка запуска TMA:
     Отправьте команду `/setmenubutton` -> выберите вашего бота -> введите текст кнопки `🚀 Открыть приложение` -> вставьте URL вашего веб-приложения (`WEBAPP_URL`).
   - Либо создайте нативный шорткат через `/newapp`.
8. (Опционально) Настройте описание `/setdescription` и аватар `/setuserpic`.

---

### Шаг 2. Запуск локально (для разработки и тестирования)

```bash
# 1. Перейдите в директорию бота
cd bot

# 2. Создайте виртуальное окружение Python
python3 -m venv venv
source venv/bin/activate  # На Windows: venv\Scripts\activate

# 3. Установите зависимости
pip install -r requirements.txt

# 4. Скопируйте конфигурационный файл
cp .env.example .env

# 5. Отредактируйте .env:
# Укажите ваш BOT_TOKEN и при необходимости ADMIN_IDS
nano .env

# 6. Запустите бота
python main.py
```
> **Примечание:** База данных SQLite `crowdship.db` создастся и инициализируется автоматически при первом запуске!

---

### Шаг 3. Запуск в Docker Compose (Production с PostgreSQL)

В репозиторий уже включены оптимизированные `Dockerfile` и `docker-compose.yml`:

```bash
# 1. Перейдите в папку бота
cd bot

# 2. Создайте .env файл и укажите BOT_TOKEN
cp .env.example .env
nano .env

# 3. Запустите контейнеры в фоновом режиме
docker compose up -d --build

# 4. Просмотр логов
docker compose logs -f bot
```

---

### Шаг 4. Деплой как systemd-сервис на Linux VPS (Ubuntu/Debian)

Если вы запускаете бота напрямую на сервере без Docker:

1. Создайте файл сервиса `/etc/systemd/system/crowdship.service`:
```ini
[Unit]
Description=Crowdshipping Telegram Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/crowdship_bot/bot
ExecStart=/home/ubuntu/crowdship_bot/bot/venv/bin/python main.py
Restart=always
RestartSec=5
EnvironmentFile=/home/ubuntu/crowdship_bot/bot/.env

[Install]
WantedBy=multi-user.target
```

2. Активируйте и запустите сервис:
```bash
sudo systemctl daemon-reload
sudo systemctl enable crowdship
sudo systemctl start crowdship
sudo systemctl status crowdship
```

---

## 📁 Структура проекта

```
bot/
├── config.py                 # Валидация и загрузка настроек (pydantic-settings)
├── database/
│   ├── db.py                 # Async SQLAlchemy engine и управление сессиями
│   └── models.py             # Модели: User, TravelTrip, ParcelRequest, MatchDeal
├── handlers/
│   ├── common.py             # /start, дисклеймер, безопасность, смена ролей, профиль
│   ├── traveler.py           # FSM-сценарий создания рейса попутчиком
│   ├── sender.py             # FSM-сценарий создания посылки с фото и бюджетом
│   └── matching.py           # Авто-мэтчинг, отклики и безопасный контакт без номеров
├── keyboards/
│   ├── reply.py              # Основное нижнее меню (ReplyKeyboardMarkup)
│   └── inline.py             # Инлайн-кнопки (дисклеймер, роли, габариты, отклики)
├── services/
│   ├── matcher.py            # Умный алгоритм сопоставления маршрутов и дат
│   └── scheduler.py          # APScheduler для фонового закрытия старых записей
├── states/
│   ├── traveler.py           # Состояния FSM для попутчика
│   └── sender.py             # Состояния FSM для отправителя
├── main.py                   # Точка входа, запуск бота и диспетчера
├── requirements.txt          # Зависимости
├── Dockerfile                # Docker сборка
├── docker-compose.yml        # Multi-container с PostgreSQL
├── .env.example              # Шаблон переменных окружения
└── README.md                 # Документация
```

---

## 🔒 Безопасность и юридические нюансы
- По правилам авиаперевозок (ИКАО/IATA) и законам о почтовой связи, перевозчик несет персональную ответственность за перевозимый багаж. Бот гарантирует донесение этого правила до каждого пользователя через обязательный экран досмотра перед доступом к функциям.
- Контактная информация передается исключительно ссылкой на аккаунт Telegram, минимизируя утечки персональных данных и телефонных спам-баз.
