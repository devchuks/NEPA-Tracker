"""Read-only grid-restoration estimates. No monitoring, writes or external services."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from itertools import groupby
from math import sqrt
from statistics import median
from threading import Lock
from time import monotonic
import os

UTC = timezone.utc
WAT = timezone(timedelta(hours=1), 'Africa/Lagos')
TRANSIENT = 120


def instant(value):
    """Existing naive records follow the backend host's clock; production defaults UTC.

    PREDICTION_STORAGE_TIMEZONE must match the clock used when records were written.
    This conversion applies only here and never rewrites a record.
    """
    if value.tzinfo is not None:
        return value.astimezone(UTC)
    name = os.getenv('PREDICTION_STORAGE_TIMEZONE', 'UTC')
    if name not in ('UTC', 'Africa/Lagos'):
        raise ValueError('Unsupported prediction storage timezone')
    return value.replace(tzinfo=UTC if name == 'UTC' else WAT).astimezone(UTC)


@dataclass(frozen=True)
class Outage:
    start: datetime
    end: datetime
    available_at: datetime

    @property
    def seconds(self):
        return (self.end - self.start).total_seconds()


def normalize(rows, now):
    """Merge short NEPA restorations first, then discard short grid outages.

    Ambiguous timestamp groups and repeated non-identical state records break the
    chain. Missing data cannot be reconstructed; uncertain pairs are discarded.
    A restoration is usable for training only after it survives >120 seconds.
    ON/GEN remains grid-unavailable, but is not confused with a duplicate OFF.
    """
    now = instant(now)
    events = sorted(((instant(r.timestamp), r.event, r.source) for r in rows
                    if r.timestamp is not None and instant(r.timestamp) <= now), key=lambda r: r[0])
    complete = []
    start = restored = None
    previous = None
    known_grid = False
    for timestamp, group in groupby(events, key=lambda item: item[0]):
        states = {(event, source) for _, event, source in group}
        if len(states) != 1:
            start = restored = previous = None
            known_grid = False
            continue
        event, source = next(iter(states))
        valid = (event == 'OFF' and source is None) or (event == 'ON' and source in ('NEPA', 'GEN'))
        if not valid:
            start = restored = previous = None
            known_grid = False
            continue
        current = (event, source)
        is_grid = event == 'ON' and source == 'NEPA'
        if restored is not None and (timestamp - restored).total_seconds() > TRANSIENT:
            if (restored - start).total_seconds() > TRANSIENT:
                complete.append(Outage(start, restored, restored + timedelta(seconds=TRANSIENT, microseconds=1)))
            start = restored = None
            known_grid = True
        # Preserve a completed, stable episode before breaking an ambiguous chain.
        if current == previous:
            start = restored = None
            known_grid = is_grid
            continue
        previous = current
        if is_grid:
            known_grid = True
            if start is not None and restored is None:
                restored = timestamp
        else:
            if restored is not None:
                restored = None  # temporary grid return: original outage continues
            elif start is None and known_grid:
                start = timestamp
    if restored is not None and (now - restored).total_seconds() > TRANSIENT:
        if (restored - start).total_seconds() > TRANSIENT:
            complete.append(Outage(start, restored, restored + timedelta(seconds=TRANSIENT, microseconds=1)))
        start = None
    return tuple(complete), start


def wilson(successes, count):
    z = 1.96
    p = successes / count
    denominator = 1 + z*z/count
    center = (p + z*z/(2*count)) / denominator
    width = z * sqrt(p*(1-p)/count + z*z/(4*count*count)) / denominator
    return [round(max(0, center-width), 3), round(min(1, center+width), 3)]


def estimate(history, start, now):
    """Empirical conditional survival, with progressively broader cohorts.

    S(t+h)/S(t) conditions on having survived the current elapsed duration.
    Quantiles are empirical order statistics, without extrapolating the tail.
    """
    start, now = instant(start), instant(now)
    elapsed = (now - start).total_seconds()
    result = dict(status='pending' if elapsed <= TRANSIENT else 'insufficient_data',
                  reason='transient_window' if elapsed <= TRANSIENT else 'too_few_comparable_outages',
                  outage_start=start.isoformat(), elapsed_seconds=max(0, elapsed),
                  generated_at=now.isoformat(), valid_until=(now + timedelta(seconds=75)).isoformat(),
                  predicted_restoration=None, window=None, probabilities=None,
                  sample_size=0, confidence=None, timezone='Africa/Lagos', target='NEPA grid')
    if elapsed <= TRANSIENT:
        return result
    local = start.astimezone(WAT)
    survivors = [x for x in history if x.available_at <= now and now-timedelta(days=730) <= x.start < start and x.seconds > elapsed]
    def clock_match(x):
        h = x.start.astimezone(WAT)
        distance = abs((h.hour*60+h.minute) - (local.hour*60+local.minute))
        return min(distance, 1440-distance) <= 180
    cohorts = [
        ('60d / start time / weekday', [x for x in survivors if x.start >= now-timedelta(days=60) and clock_match(x) and x.start.astimezone(WAT).weekday() == local.weekday()]),
        ('60d / start time', [x for x in survivors if x.start >= now-timedelta(days=60) and clock_match(x)]),
        ('60d / all starts', [x for x in survivors if x.start >= now-timedelta(days=60)]),
        ('180d / all starts', [x for x in survivors if x.start >= now-timedelta(days=180)]),
        ('730d / all starts', survivors),
    ]
    label, chosen = next(((label, examples) for label, examples in cohorts if len(examples) >= 12), cohorts[-1])
    result['sample_size'] = len(chosen)
    result['comparison'] = label
    if len(chosen) < 8:
        return result
    remaining = sorted(x.seconds - elapsed for x in chosen)
    def quantile(p):
        return remaining[min(len(remaining)-1, int(p * (len(remaining)-1)))]
    # Display precision is minutes, statistical interval is the central 80%.
    def at(seconds):
        return (now + timedelta(seconds=seconds)).astimezone(WAT).isoformat()
    probabilities = {}
    for hours in (1, 2, 4):
        hits = sum(seconds <= hours*3600 for seconds in remaining)
        probabilities[str(hours)] = {'value': hits / len(chosen), 'interval_95': wilson(hits, len(chosen))}
    result.update(status='active', reason=None, predicted_restoration=at(median(remaining)),
                  window={'start': at(quantile(.1)), 'end': at(quantile(.9)), 'nominal_coverage': .8},
                  probabilities=probabilities,
                  confidence='moderate' if len(chosen) >= 30 and label.startswith('60d') else 'low',
                  uncertainty='Empirical historical estimate; routines can change. Probability ranges are 95% Wilson intervals.')
    return result


class PredictionCache:
    """Per-process history cache. No training workers or monitoring-lock use."""
    def __init__(self, ttl=300):
        self.ttl = ttl
        self.lock = Lock()
        self.revision = 0
        self.loaded_revision = -1
        self.loaded_at = 0
        self.history = ()
        self.current_start = None
        self.signature = None

    def invalidate(self):
        # Constant-time; safe to call after history commits.
        self.revision += 1

    def get(self, loader, signature, now):
        with self.lock:
            if (self.loaded_revision != self.revision or self.signature != signature
                    or monotonic()-self.loaded_at >= self.ttl):
                revision = self.revision
                rows = loader()
                history, start = normalize(rows, now)
                self.history, self.current_start = history, start
                self.loaded_at, self.loaded_revision = monotonic(), revision
                self.signature = signature
            return self.history, self.current_start


cache = PredictionCache()


def backtest(rows, as_of=None):
    """Expanding-window replay. Re-normalize only the prefix visible at origin.

    Completed target outcomes are used ONLY for scoring. The origin-zero case
    is reported as ineligible. Censored/unpaired outcomes cannot be scored.
    """
    final_now = instant(as_of) if as_of is not None else datetime.now(UTC)
    rows = sorted((r for r in rows if instant(r.timestamp) <= final_now), key=lambda r: instant(r.timestamp))
    if not rows:
        return {'cases': 0, 'durations': {}, 'named_case': None}
    outcomes, _ = normalize(rows, final_now)
    scores = defaultdict(list)
    named = None
    for outage in outcomes:
        local = outage.start.astimezone(WAT)
        if local.strftime('%Y-%m-%d %H:%M') == '2026-10-28 20:29':
            named = {'start': local.isoformat(), 'end': outage.end.astimezone(WAT).isoformat(),
                     'duration_minutes': outage.seconds/60, 'forecasts': []}
        for minutes in (0, 30, 60, 120, 180):
            now = outage.start + timedelta(minutes=minutes)
            if now >= outage.end:
                continue
            prefix = [r for r in rows if instant(r.timestamp) <= now]
            history, current = normalize(prefix, now)
            prediction = estimate(history, current or outage.start, now)
            if named and named['start'] == local.isoformat():
                named['forecasts'].append({'elapsed_minutes': minutes, 'forecast': prediction})
            if prediction['status'] != 'active':
                continue
            predicted = datetime.fromisoformat(prediction['predicted_restoration'])
            window = prediction['window']
            earlier = [x.seconds for x in history if x.available_at <= now and x.start < outage.start]
            baseline_end = max(now, outage.start + timedelta(seconds=median(earlier)))
            scores[minutes].append({'error': abs((predicted-outage.end).total_seconds())/60,
                'baseline_error': abs((baseline_end-outage.end).total_seconds())/60,
                'covered': datetime.fromisoformat(window['start']) <= outage.end <= datetime.fromisoformat(window['end']),
                'probabilities': {h: (v['value'], (outage.end-now).total_seconds() <= int(h)*3600)
                                  for h, v in prediction['probabilities'].items()}})
    summary = {}
    for minutes in (0, 30, 60, 120, 180):
        values = scores[minutes]
        summary[str(minutes)] = {'forecasts': len(values), 'eligible': minutes > 2}
        if values:
            calibration = {}
            for h in ('1', '2', '4'):
                pairs = [v['probabilities'][h] for v in values]
                calibration[h] = {'brier_score': sum((p-y)**2 for p,y in pairs)/len(pairs),
                    'mean_probability': sum(p for p,_ in pairs)/len(pairs),
                    'observed_rate': sum(y for _,y in pairs)/len(pairs),
                    'bins': []}
                for lo in range(5):
                    bucket = [(p,y) for p,y in pairs if lo/5 <= p <= (lo+1)/5
                              and (lo == 4 or p < (lo+1)/5)]
                    calibration[h]['bins'].append({'range': [lo/5,(lo+1)/5], 'count': len(bucket),
                        'mean_probability': sum(p for p,_ in bucket)/len(bucket) if bucket else None,
                        'observed_rate': sum(y for _,y in bucket)/len(bucket) if bucket else None})
            summary[str(minutes)].update(median_absolute_error_minutes=median(v['error'] for v in values),
                baseline_median_absolute_error_minutes=median(v['baseline_error'] for v in values),
                interval_coverage=sum(v['covered'] for v in values)/len(values), calibration=calibration)
    return {'cases': len(outcomes), 'durations': summary, 'named_case': named}
