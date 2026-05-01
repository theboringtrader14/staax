"""
One-off migration: add initial_capital + initial_capital_set_at to accounts table.
Run once: cd backend && source venv/bin/activate && python3.12 migrate_initial_capital.py
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text


async def migrate():
    engine = create_async_engine("postgresql+asyncpg://bjkarthi@localhost/staax_db")
    async with engine.begin() as conn:
        await conn.execute(text("""
            ALTER TABLE accounts
            ADD COLUMN IF NOT EXISTS initial_capital DECIMAL(14,2),
            ADD COLUMN IF NOT EXISTS initial_capital_set_at TIMESTAMPTZ
        """))
        print("Migration complete — initial_capital columns added to accounts table")
        r = await conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'accounts'
            AND column_name ILIKE '%capital%'
        """))
        print("Verified columns:", [row[0] for row in r.fetchall()])


asyncio.run(migrate())
