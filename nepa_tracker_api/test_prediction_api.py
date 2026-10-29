"""Integration checks use a disposable SQLite DB; never the configured database."""
import os
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta
from sqlalchemy import event

test_directory = tempfile.TemporaryDirectory(prefix='nepa-prediction-test-')
os.environ['DATABASE_URL'] = 'sqlite:///' + test_directory.name.replace('\\','/') + '/test.db'
os.environ['PREDICTION_STORAGE_TIMEZONE'] = 'UTC'
import main


class PredictionAPITests(unittest.TestCase):
    def setUp(self):
        with main.SessionLocal() as db:
            db.query(main.PowerLog).delete()
            db.query(main.PowerStatus).delete()
            db.commit()
        main.prediction_cache.invalidate()

    def seed(self, age=3600):
        now = datetime.now()
        with main.SessionLocal() as db:
            db.add(main.PowerStatus(id=1,is_online=False,source='NEPA',last_ping=now))
            for day in range(40,0,-1):
                base = now-timedelta(days=day)
                db.add_all([main.PowerLog(event='ON',source='NEPA',timestamp=base-timedelta(hours=1)),
                            main.PowerLog(event='OFF',timestamp=base),
                            main.PowerLog(event='ON',source='NEPA',timestamp=base+timedelta(hours=day%4+2))])
            db.add(main.PowerLog(event='OFF',timestamp=now-timedelta(seconds=age)))
            db.commit()

    def result(self):
        with main.SessionLocal() as db:
            return main.get_restoration_prediction(db)

    def test_inactive_and_missing_state(self):
        self.assertEqual(self.result()['status'],'unavailable')
        self.seed()
        with main.SessionLocal() as db:
            db.get(main.PowerStatus,1).is_online=True
            db.commit()
        self.assertEqual(self.result()['status'],'inactive')

    def test_pending_and_active_and_no_writes(self):
        self.seed(age=119)
        self.assertEqual(self.result()['status'],'pending')
        with main.SessionLocal() as db:
            latest=db.query(main.PowerLog).order_by(main.PowerLog.timestamp.desc()).first()
            latest.timestamp=datetime.now()-timedelta(hours=1)
            db.commit()
            count=db.query(main.PowerLog).count()
        self.assertEqual(self.result()['status'],'active')
        with main.SessionLocal() as db: self.assertEqual(db.query(main.PowerLog).count(),count)

    def test_orm_mutations_invalidate_but_heartbeat_commit_does_not(self):
        self.seed()
        revision=main.prediction_cache.revision
        with main.SessionLocal() as db:
            db.get(main.PowerStatus,1).last_ping=datetime.now()
            db.commit()
        self.assertEqual(main.prediction_cache.revision,revision)
        with main.SessionLocal() as db:
            row=db.query(main.PowerLog).first(); row.source='GEN'; db.commit()
        self.assertGreater(main.prediction_cache.revision,revision)
        revision=main.prediction_cache.revision
        with main.SessionLocal() as db:
            db.query(main.PowerLog).filter(main.PowerLog.id==-1).delete(synchronize_session=False)
            db.commit()
        self.assertGreater(main.prediction_cache.revision,revision)

    def test_cached_request_query_budget_and_failure_isolation(self):
        self.seed()
        self.result()
        statements=[]
        def observe(conn,cursor,statement,parameters,context,many): statements.append(statement)
        event.listen(main.engine,'before_cursor_execute',observe)
        try:
            self.result()
        finally:
            event.remove(main.engine,'before_cursor_execute',observe)
        self.assertEqual(len(statements),2)
        self.assertTrue(all('LIMIT' in query for query in statements))
        print('Warm forecast request: 2 bounded SELECTs; no history reload or writes')
        with patch.object(main.prediction_cache,'get',side_effect=RuntimeError('test forecast failure')):
            with self.assertLogs(main.__name__,level='ERROR'):
                self.assertEqual(self.result()['status'],'unavailable')
            with main.SessionLocal() as db:
                self.assertEqual(main.get_status(db)['nepa'],'OFF')

    def test_rollback_does_not_invalidate(self):
        self.seed()
        revision=main.prediction_cache.revision
        with main.SessionLocal() as db:
            row=db.query(main.PowerLog).first(); row.source='GEN'; db.flush(); db.rollback()
        self.assertEqual(main.prediction_cache.revision,revision)


def tearDownModule():
    main.engine.dispose()
    test_directory.cleanup()


if __name__=='__main__': unittest.main()
