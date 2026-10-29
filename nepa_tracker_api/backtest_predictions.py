"""Run read-only production backtesting without importing the monitoring app.

Usage: python backtest_predictions.py (reads DATABASE_URL from environment/.env).
Only aggregates and the specifically requested Oct 28–29 example are printed.
"""
import json
import argparse
from datetime import datetime
from types import SimpleNamespace
import os
from pathlib import Path
from time import perf_counter
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from prediction_service import backtest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', type=Path, default=Path(__file__).with_name('.env'))
    parser.add_argument('--allow-sqlite', action='store_true', help='Explicitly evaluate local data, not production')
    args = parser.parse_args()
    load_dotenv(args.env_file)
    url = os.getenv('DATABASE_URL')
    if not url:
        raise SystemExit('DATABASE_URL is not configured; production backtest was not run.')
    started = perf_counter()
    engine = create_engine(url, connect_args={'connect_timeout': 8} if url.startswith('postgres') else {})
    try:
        if engine.dialect.name != 'postgresql' and not args.allow_sqlite:
            raise SystemExit('Configured database is not PostgreSQL. Production backtest not run. Use --allow-sqlite only for local data.')
        with engine.connect() as connection:
            if connection.dialect.name == 'postgresql':
                connection.execute(text('SET TRANSACTION READ ONLY'))
                connection.execute(text("SET LOCAL statement_timeout = '10000ms'"))
            rows = connection.execute(text('SELECT timestamp, event, source FROM power_logs ORDER BY timestamp, id')).all()
        records = [SimpleNamespace(timestamp=datetime.fromisoformat(r.timestamp) if isinstance(r.timestamp,str) else r.timestamp,
                                  event=r.event, source=r.source) for r in rows]
        report = backtest(records)
        report['database_dialect'] = engine.dialect.name
        report['raw_record_count'] = len(rows)
        report['runtime_seconds'] = round(perf_counter()-started,3)
        report['storage_timezone'] = os.getenv('PREDICTION_STORAGE_TIMEZONE','UTC')
        print(json.dumps(report,indent=2))
    except Exception as error:
        # Driver exceptions can contain credentials/connection strings.
        raise SystemExit(f'Read-only backtest failed ({type(error).__name__}); no database writes performed.') from None
    finally:
        engine.dispose()


if __name__ == '__main__': main()
