/**
 * Catalog of all Python Bot source code files for the interactive viewer and ZIP generator.
 */

export interface CodeFile {
  name: string;
  path: string;
  language: string;
  category: 'core' | 'database' | 'handlers' | 'keyboards' | 'services' | 'states' | 'deploy';
  description: string;
}

export const BOT_FILES_MANIFEST: CodeFile[] = [
  {
    name: "main.py",
    path: "/bot/main.py",
    language: "python",
    category: "core",
    description: "Точка входа: инициализация aiogram 3.x, регистрация роутеров, базы данных и планировщика"
  },
  {
    name: "config.py",
    path: "/bot/config.py",
    language: "python",
    category: "core",
    description: "Настройки приложения с валидацией через Pydantic Settings и .env"
  },
  {
    name: "database/models.py",
    path: "/bot/database/models.py",
    language: "python",
    category: "database",
    description: "SQLAlchemy 2.0 модели: User, TravelTrip, ParcelRequest, MatchDeal и перечисления"
  },
  {
    name: "database/db.py",
    path: "/bot/database/db.py",
    language: "python",
    category: "database",
    description: "Асинхронный движок базы данных (PostgreSQL / SQLite) и управление сессиями"
  },
  {
    name: "services/matcher.py",
    path: "/bot/services/matcher.py",
    language: "python",
    category: "services",
    description: "Алгоритм умного авто-сопоставления маршрутов и отправки мгновенных Push-уведомлений"
  },
  {
    name: "services/scheduler.py",
    path: "/bot/services/scheduler.py",
    language: "python",
    category: "services",
    description: "Фоновый планировщик APScheduler для архивации устаревших рейсов и заявок"
  },
  {
    name: "handlers/common.py",
    path: "/bot/handlers/common.py",
    language: "python",
    category: "handlers",
    description: "Обработчики /start, обязательного досмотра, безопасности, профиля и переключения ролей"
  },
  {
    name: "handlers/traveler.py",
    path: "/bot/handlers/traveler.py",
    language: "python",
    category: "handlers",
    description: "FSM-сценарий создания рейса попутчиком и управление поездками"
  },
  {
    name: "handlers/sender.py",
    path: "/bot/handlers/sender.py",
    language: "python",
    category: "handlers",
    description: "FSM-сценарий создания посылки с фото, бюджетом и триггером авто-мэтчинга"
  },
  {
    name: "handlers/matching.py",
    path: "/bot/handlers/matching.py",
    language: "python",
    category: "handlers",
    description: "Обработка откликов попутчиков, создание сделок и безопасный контакт без номеров"
  },
  {
    name: "keyboards/reply.py",
    path: "/bot/keyboards/reply.py",
    language: "python",
    category: "keyboards",
    description: "Главное меню бота (ReplyKeyboardMarkup) и кнопки отмены"
  },
  {
    name: "keyboards/inline.py",
    path: "/bot/keyboards/inline.py",
    language: "python",
    category: "keyboards",
    description: "Инлайн-кнопки (дисклеймер, роли, габариты, быстрые даты, отклики и ссылки)"
  },
  {
    name: "states/traveler.py",
    path: "/bot/states/traveler.py",
    language: "python",
    category: "states",
    description: "Класс состояний FSM для путешественника"
  },
  {
    name: "states/sender.py",
    path: "/bot/states/sender.py",
    language: "python",
    category: "states",
    description: "Класс состояний FSM для отправителя"
  },
  {
    name: "requirements.txt",
    path: "/bot/requirements.txt",
    language: "text",
    category: "deploy",
    description: "Зависимости проекта (aiogram, SQLAlchemy, asyncpg, APScheduler)"
  },
  {
    name: "docker-compose.yml",
    path: "/bot/docker-compose.yml",
    language: "yaml",
    category: "deploy",
    description: "Конфигурация для запуска бота и PostgreSQL 16 в Docker контейнерах"
  },
  {
    name: "Dockerfile",
    path: "/bot/Dockerfile",
    language: "dockerfile",
    category: "deploy",
    description: "Инструкция сборки легковесного Python 3.11 образа"
  },
  {
    name: ".env.example",
    path: "/bot/.env.example",
    language: "shell",
    category: "deploy",
    description: "Шаблон конфигурационных переменных окружения"
  },
  {
    name: "README.md",
    path: "/bot/README.md",
    language: "markdown",
    category: "deploy",
    description: "Полная инструкция по регистрации в @BotFather, запуску и деплою на VPS"
  }
];
