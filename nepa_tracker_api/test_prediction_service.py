import os
os.environ['PREDICTION_STORAGE_TIMEZONE'] = 'UTC'
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from time import perf_counter
from prediction_service import normalize, estimate, PredictionCache, backtest, instant

BASE = datetime(2026, 10, 1, tzinfo=timezone.utc)


def rows(*events):
    return [SimpleNamespace(timestamp=BASE+timedelta(seconds=t), event=e,
                            source=s) for t, e, s in events]


class PredictionTests(unittest.TestCase):
    def test_threshold_and_microseconds(self):
        for seconds in (10, 59, 119, 120, 120.000001, 121):
            with self.subTest(seconds=seconds):
                records = rows((0, 'ON', 'NEPA'), (1, 'OFF', None), (1+seconds, 'ON', 'NEPA'))
                before = [(r.timestamp, r.event, r.source) for r in records]
                history, _ = normalize(records, BASE+timedelta(seconds=1000))
                self.assertEqual(len(history), int(seconds > 120))
                self.assertEqual(before, [(r.timestamp, r.event, r.source) for r in records])

    def test_temporary_restoration_merges_repeated_switching(self):
        records = rows((0,'ON','NEPA'), (1,'OFF',None), (200,'ON','NEPA'),
                       (320,'OFF',None), (400,'ON','GEN'), (600,'ON','NEPA'),
                       (610,'OFF',None), (900,'ON','NEPA'))
        history, start = normalize(records, BASE+timedelta(seconds=1100))
        self.assertIsNone(start)
        self.assertEqual([x.seconds for x in history], [899])

    def test_transient_outage_followed_by_transient_return(self):
        history, _ = normalize(rows((0,'ON','NEPA'),(1,'OFF',None),(11,'ON','NEPA'),
                                    (20,'OFF',None),(500,'ON','NEPA')), BASE+timedelta(seconds=700))
        self.assertEqual(history[0].seconds, 499)

    def test_gen_is_not_restoration(self):
        records = rows((0,'ON','NEPA'), (1,'OFF',None), (200,'ON','GEN'), (700,'ON','NEPA'))
        history, _ = normalize(records, BASE+timedelta(seconds=900))
        self.assertEqual(history[0].seconds, 699)

    def test_duplicates_missing_invalid_and_conflicting(self):
        cases = [rows((0,'OFF',None),(500,'ON','NEPA')),
                 rows((0,'ON','NEPA'),(1,'OFF',None),(500,'OFF',None),(900,'ON','NEPA')),
                 rows((0,'ON','NEPA'),(1,'OFF',None)),
                 rows((0,'ON','NEPA'),(1,'OFF',None),(500,'ON','NEPA'),(500,'OFF',None)),
                 rows((0,'ON','NEPA'),(1,'OFF',None),(400,'BROKEN',None),(900,'ON','NEPA'))]
        for records in cases:
            self.assertEqual(normalize(records, BASE+timedelta(seconds=1200))[0], ())
        exact = rows((0,'ON','NEPA'),(1,'OFF',None),(1,'OFF',None),(500,'ON','NEPA'))
        self.assertEqual(len(normalize(exact, BASE+timedelta(seconds=900))[0]), 1)

    def test_deleted_or_edited_counterpart(self):
        records = rows((0,'ON','NEPA'),(1,'OFF',None),(500,'ON','NEPA'),(800,'OFF',None),(1300,'ON','NEPA'))
        self.assertEqual(len(normalize(records, BASE+timedelta(seconds=1500))[0]),2)
        del records[2]
        self.assertEqual(normalize(records, BASE+timedelta(seconds=1500))[0],())
        records[2].timestamp = BASE+timedelta(seconds=1)
        self.assertEqual(len(normalize(records, BASE+timedelta(seconds=1500))[0]),1)

    def test_restoration_requires_stability_at_prediction_time(self):
        records = rows((0,'ON','NEPA'),(1,'OFF',None),(500,'ON','NEPA'))
        self.assertEqual(normalize(records,BASE+timedelta(seconds=620))[0],())
        self.assertEqual(len(normalize(records,BASE+timedelta(seconds=620,microseconds=1))[0]),1)

    def test_wat_day_boundary_and_naive_timestamp(self):
        self.assertEqual(instant(datetime(2026,10,28,20,29)),datetime(2026,10,28,20,29,tzinfo=timezone.utc))
        from prediction_service import WAT
        start = datetime(2026,10,28,20,29,tzinfo=WAT)
        end = datetime(2026,10,29,3,10,tzinfo=WAT)
        self.assertEqual((instant(end)-instant(start)).total_seconds(), 24060)

    def fixture(self):
        records=[]
        for day in range(60):
            start=BASE+timedelta(days=day)
            for seconds,event,source in ((0,'ON','NEPA'),(3600,'OFF',None),(3600+(day%6+1)*3600,'ON','NEPA')):
                records.append(SimpleNamespace(timestamp=start+timedelta(seconds=seconds),event=event,source=source))
        return records

    def test_conditioning_no_expired_estimates_and_no_future_leak(self):
        history,_=normalize(self.fixture(),BASE+timedelta(days=61))
        start=BASE+timedelta(days=61,hours=1)
        result=estimate(history,start,start+timedelta(hours=3))
        self.assertEqual(result['status'],'active')
        self.assertTrue(all(x.seconds > 10800 for x in history if x in history and x.start < start) or result['sample_size'] < len(history))
        self.assertGreater(datetime.fromisoformat(result['window']['start']),start+timedelta(hours=3))
        self.assertEqual(result['sample_size'],30)
        self.assertLessEqual(result['probabilities']['1']['value'],result['probabilities']['2']['value'])
        self.assertLessEqual(result['probabilities']['2']['value'],result['probabilities']['4']['value'])
        self.assertEqual(estimate(history,start,start+timedelta(seconds=120))['status'],'pending')
        self.assertEqual(estimate([],start,start+timedelta(hours=1))['status'],'insufficient_data')
        before=estimate(history,BASE+timedelta(days=1),BASE+timedelta(days=1,hours=1))
        self.assertNotEqual(before['status'],'active')

    def test_cache_invalidation_signature_and_latency(self):
        cache=PredictionCache()
        calls=[]
        def load(): calls.append(1); return self.fixture()
        for _ in range(20): cache.get(load,'same',BASE+timedelta(days=61))
        self.assertEqual(len(calls),1)
        cache.invalidate(); cache.get(load,'same',BASE+timedelta(days=61))
        cache.get(load,'new',BASE+timedelta(days=61))
        self.assertEqual(len(calls),3)
        history,_=cache.get(load,'new',BASE+timedelta(days=61))
        now=BASE+timedelta(days=61,hours=3)
        begin=perf_counter()
        for _ in range(100): estimate(history,now-timedelta(hours=2),now)
        print(f'Cached calculation: {(perf_counter()-begin)*10:.3f} ms/request; 20 unchanged requests used one loader call')

    def test_chronological_backtest(self):
        report=backtest(self.fixture(), BASE+timedelta(days=61))
        self.assertEqual(report['durations']['0']['forecasts'],0)
        self.assertGreater(report['durations']['60']['forecasts'],0)
        self.assertIn('baseline_median_absolute_error_minutes',report['durations']['60'])
        self.assertIsNone(report['named_case'])
        print('SYNTHETIC BACKTEST:',report['durations']['60'])

    def test_backtest_does_not_invent_final_stability_or_read_future(self):
        records=rows((0,'ON','NEPA'),(1,'OFF',None),(500,'ON','NEPA'))
        self.assertEqual(backtest(records,BASE+timedelta(seconds=620))['cases'],0)
        self.assertEqual(backtest(records,BASE+timedelta(seconds=622))['cases'],1)
        self.assertEqual(backtest(records,BASE+timedelta(seconds=400))['cases'],0)


if __name__ == '__main__': unittest.main()
