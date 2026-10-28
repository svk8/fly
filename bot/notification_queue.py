"""Inspect outbox status or retry a permanently failed delivery after fixing its cause."""
import argparse
import asyncio
from datetime import datetime
from sqlalchemy import select, func, update
from database.db import get_db_session, engine
from database.models import NotificationJob


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['status', 'retry'])
    parser.add_argument('--id', type=int)
    args = parser.parse_args()
    try:
        async with get_db_session() as session:
            if args.command == 'retry':
                if not args.id:
                    parser.error('retry requires --id')
                result = await session.execute(update(NotificationJob).where(NotificationJob.id == args.id, NotificationJob.status == 'failed')
                    .values(status='pending', next_attempt_at=datetime.utcnow(), last_error=None, lease_until=None, lease_token=None))
                print(f'Requeued: {result.rowcount}')
            else:
                for state, count in (await session.execute(select(NotificationJob.status, func.count()).group_by(NotificationJob.status))).all():
                    print(f'{state}: {count}')
                failures = (await session.scalars(select(NotificationJob).where(NotificationJob.status == 'failed').order_by(NotificationJob.id.desc()).limit(20))).all()
                for job in failures:
                    print(f'id={job.id} kind={job.kind} attempts={job.attempts} error={job.last_error}')
    finally:
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
