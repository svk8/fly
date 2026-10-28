"""
Main Entrypoint for the Crowdshipping Telegram Bot.
Built with aiogram 3.x, SQLAlchemy (Async), and APScheduler.
"""

import asyncio
import logging
import sys

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand

from config import settings
from database.db import init_db
from handlers.common import router as common_router
from handlers.traveler import router as traveler_router
from handlers.sender import router as sender_router
from handlers.matching import router as matching_router
from services.scheduler import start_scheduler, stop_scheduler


# Configure structured logging
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s:%(funcName)s:%(lineno)d - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("crowdship_bot")


async def setup_bot_commands(bot: Bot) -> None:
    """Register standard commands in Telegram menu button."""
    commands = [
        BotCommand(command="start", description="🚀 Главное меню и перезапуск"),
        BotCommand(command="profile", description="👤 Мой профиль и роль"),
        BotCommand(command="rules", description="🛡️ Правила безопасности и досмотра"),
    ]
    await bot.set_my_commands(commands)
    logger.info("Bot commands menu registered successfully.")


async def main() -> None:
    """Initialize resources, routers, and launch polling loop."""
    logger.info("Starting Crowdshipping Marketplace Bot...")

    # 1. Initialize Database schema
    await init_db()

    # 2. Instantiate Bot with HTML parse mode by default
    bot = Bot(
        token=settings.BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML)
    )

    # 3. Instantiate Dispatcher with in-memory FSM storage
    dp = Dispatcher(storage=MemoryStorage())

    # 4. Register Modular Handlers
    dp.include_router(common_router)
    dp.include_router(traveler_router)
    dp.include_router(sender_router)
    dp.include_router(matching_router)

    # 5. Start Background Scheduler
    start_scheduler(bot)

    # 6. Configure Bot Menu Commands
    await setup_bot_commands(bot)

    # Notify Admins on startup
    for admin_id in settings.admin_ids:
        try:
            await bot.send_message(
                chat_id=admin_id,
                text="🚀 <b>Бот P2P-доставки посылок запущен и готов к работе!</b>",
                parse_mode="HTML"
            )
        except Exception as e:
            logger.warning(f"Could not send startup alert to admin {admin_id}: {e}")

    try:
        # Delete pending webhooks and start polling
        await bot.delete_webhook(drop_pending_updates=True)
        logger.info("Bot polling is active. Press Ctrl+C to stop.")
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        logger.info("Shutting down bot...")
        stop_scheduler()
        await bot.session.close()
        logger.info("Bot shutdown complete.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot execution terminated by user.")
