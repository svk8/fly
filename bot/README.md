# Python-бот и API FlyParcel

Это общий backend чат-бота и Mini App: одни SQLAlchemy-модели, пользователи, заявки, рейсы и сделки. Бот получает Telegram updates через long polling; aiohttp API обслуживает запросы Mini App на внутреннем порту 8000. Node.js передает ему `/api/*` и раздает веб-интерфейс.

Общий запуск всех частей, настройки и резервные копии описаны в [корневом README](../README.md). Используйте `docker compose up -d --build` из корня проекта.

Для разработки запускайте из корня:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r bot/requirements.txt
cp .env.example .env
# Заполните BOT_TOKEN и APP_URL
python bot/main.py
```

В другом терминале: `npm ci && npm run dev` (Node.js 24).

Чат-сценарии: /start, согласие с правилами, выбор роли, создание рейса или посылки, подбор по маршрутам, уведомления, /deals и смена статусов. /admin, /ban и /unban доступны ID из ADMIN_IDS. Блокировка действует и на Mini App.

Dockerfile и compose.yaml находятся только в корне проекта; цель bot собирает Python backend, цель web — веб-интерфейс. SQLite-резервные копии делаются `python backup.py`; для PostgreSQL используйте pg_dump.

DatabaseStorage сохраняет текущий шаг и данные незавершенного диалога в таблице dialog_states общей БД. После перезапуска пользователь продолжает заполнение; /start и отмена очищают черновик. Таблица добавляется автоматически, дополнительный сервис не нужен. При старте бот удаляет старый webhook, сохраняя ожидающие updates. Только один экземпляр polling-процесса может работать с данным токеном.


Уведомления о совпадениях маршрутов и изменениях сделки отправляет NotificationWorker из таблицы notification_jobs. Задания добавляются в одной транзакции с заявкой/сделкой. Сетевые ошибки повторяются с увеличением паузы; при перезапуске очередь сохраняется. Постоянные ошибки Telegram доступны через `python notification_queue.py status`; команда `python notification_queue.py retry --id 123` возвращает исправленную запись failed в очередь. При потере ответа Telegram возможен дубликат; подтверждения прочтения нет. Подробности — в корневом README.
