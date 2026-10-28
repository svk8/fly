"""Transactional outbox helpers. Call before committing the business transaction."""
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from database.models import NotificationJob


async def enqueue(session, key, kind, payload):
    dialect = session.bind.dialect.name
    if dialect not in ('sqlite', 'postgresql'):
        raise RuntimeError(f'Unsupported outbox database: {dialect}')
    insert = sqlite_insert if dialect == 'sqlite' else postgres_insert
    await session.execute(insert(NotificationJob).values(dedup_key=key, kind=kind, payload=payload)
        .on_conflict_do_nothing(index_elements=[NotificationJob.dedup_key]))


async def enqueue_listing(session, kind, listing_id):
    await enqueue(session, f'{kind}:{listing_id}:created', f'{kind}_created', {'id': listing_id})


async def enqueue_deal(session, deal, actor_telegram_id):
    await enqueue(session, f'deal:{deal.id}:{deal.status}', 'deal_changed',
        {'id': deal.id, 'status': deal.status, 'actor_id': actor_telegram_id})
