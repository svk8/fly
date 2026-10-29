"""Single owner of Telegram updates; chat handlers and Mini App API share the database."""
import asyncio
import logging
import signal
from aiohttp import web
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import SimpleEventIsolation
from database.fsm import DatabaseStorage
from aiogram.types import BotCommand, MenuButtonWebApp, WebAppInfo
from config import settings
from database.db import init_db, engine
from handlers.common import router as common_router
from handlers.traveler import router as traveler_router
from handlers.sender import router as sender_router
from handlers.matching import router as matching_router
from handlers.admin import router as admin_router
from services.scheduler import start_scheduler, stop_scheduler
from middleware import AccountMiddleware
from api import create_api, BOT_URL
from services.notification_worker import NotificationWorker
from monitoring import init_monitoring, report_exception, flush_monitoring

logging.basicConfig(level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s - %(message)s")


async def main():
    await init_db()
    bot = Bot(settings.BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher(storage=DatabaseStorage(), events_isolation=SimpleEventIsolation())
    dp.message.outer_middleware(AccountMiddleware())
    dp.callback_query.outer_middleware(AccountMiddleware())
    @dp.errors()
    async def handle_error(event):
        report_exception(event.exception, 'bot')
        logging.error('Bot handler failed', exc_info=(type(event.exception), event.exception, event.exception.__traceback__))
        return True

    for router in (common_router, admin_router, traveler_router, sender_router, matching_router):
        dp.include_router(router)
    worker = NotificationWorker(bot)
    worker_task = None
    api = create_api(bot)
    runner = web.AppRunner(api, access_log=None)
    try:
        if settings.BOT_POLLING:
            me = await bot.get_me()
            if me.username:
                api[BOT_URL] = "https://t.me/" + me.username
        await runner.setup()
        await web.TCPSite(runner, settings.API_HOST, settings.API_PORT).start()
        if settings.BOT_POLLING:
            await bot.set_my_commands([BotCommand(command="start", description="Главное меню"),
                BotCommand(command="profile", description="Мой профиль"), BotCommand(command="deals", description="Мои сделки"),
                BotCommand(command="rules", description="Правила безопасности")])
            if settings.WEBAPP_URL:
                await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Открыть FlyParcel", web_app=WebAppInfo(url=settings.WEBAPP_URL)))
            # Remove a webhook from an earlier deployment; keep pending updates.
            await bot.delete_webhook(drop_pending_updates=False)
            worker_task = asyncio.create_task(worker.run(), name="notification_worker")
            start_scheduler(bot)
            await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types(), close_bot_session=False)
        else:
            logging.warning("BOT_POLLING=false: API-only mode for local checks; Telegram updates are not consumed")
            stopped = asyncio.Event()
            loop = asyncio.get_running_loop()
            for sig in (signal.SIGINT, signal.SIGTERM):
                loop.add_signal_handler(sig, stopped.set)
            await stopped.wait()
    finally:
        stop_scheduler()
        await runner.cleanup()
        if worker_task:
            await worker.stop(worker_task)
        await bot.session.close()
        await dp.storage.close()
        await engine.dispose()


if __name__ == "__main__":
    init_monitoring()
    try:
        asyncio.run(main())
    except Exception as error:
        report_exception(error, 'startup')
        raise
    finally:
        flush_monitoring()
