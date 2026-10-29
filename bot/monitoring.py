"""Optional error reporting. Request payloads, Telegram identity and credentials are excluded."""
import logging
import re
import sentry_sdk
from config import settings

logger = logging.getLogger(__name__)
TOKEN = re.compile(r'\d{6,12}:[A-Za-z0-9_-]{8,}\b')
INIT_DATA = re.compile(r'(?i)(tgWebAppData|initData|authorization|cookie)([=:]\s*)[^\s&]+')


def _clean(value):
    if isinstance(value, str):
        value = value.replace(settings.BOT_TOKEN, '[redacted]') if settings.BOT_TOKEN else value
        return INIT_DATA.sub(r'\1\2[redacted]', TOKEN.sub('[redacted]', value))
    if isinstance(value, list):
        return [_clean(item) for item in value]
    if isinstance(value, dict):
        return {key: _clean(item) for key, item in value.items() if key not in {'vars', 'data', 'headers', 'cookies', 'query_string'}}
    return value


def sanitize_event(event, hint=None):
    for key in ('request', 'user', 'breadcrumbs', 'extra', 'logentry'):
        event.pop(key, None)
    return _clean(event)


def init_monitoring():
    if not settings.GLITCHTIP_DSN:
        return
    try:
        sentry_sdk.init(dsn=settings.GLITCHTIP_DSN, environment=settings.MONITORING_ENVIRONMENT,
            release=settings.RELEASE, send_default_pii=False, include_local_variables=False,
            default_integrations=False, traces_sample_rate=0, max_request_body_size='never',
            before_send=sanitize_event)
    except Exception as error:
        logger.warning('Monitoring initialization failed: %s', type(error).__name__)


def report_exception(error, component):
    if not settings.GLITCHTIP_DSN:
        return
    try:
        with sentry_sdk.isolation_scope() as scope:
            scope.set_tag('component', component)
            sentry_sdk.capture_exception(error)
    except Exception:
        logger.warning('Error reporting unavailable')


def flush_monitoring():
    if settings.GLITCHTIP_DSN:
        sentry_sdk.flush(timeout=2)
