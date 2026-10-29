import { memo, useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

const clock = value => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true,
}).format(new Date(value)).toUpperCase();
const calendarDay = value => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date(value));
  const part = type => Number(parts.find(p => p.type === type).value);
  return Date.UTC(part('year'), part('month') - 1, part('day'));
};
const fullDay = value => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long',
}).format(new Date(value));

function describeDay(value, reference) {
  const offset = (calendarDay(value) - calendarDay(reference)) / 86400000;
  return offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : `on ${fullDay(value)}`;
}

function returnWindow(window, reference) {
  if (calendarDay(window.start) === calendarDay(window.end)) {
    return `${describeDay(window.start, reference)} between ${clock(window.start)} and ${clock(window.end)}`;
  }
  return `between ${clock(window.start)} ${describeDay(window.start, reference)} and ${clock(window.end)} ${describeDay(window.end, reference)}`;
}

function Elapsed({ seconds: elapsed, receivedAt }) {
  const [now, setNow] = useState(receivedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor(elapsed + Math.max(0, now - receivedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return <span>Off for {hours ? `${hours}h ${minutes}m` : `${minutes} min`}</span>;
}

function RestorationForecast({ status, apiUrl }) {
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (status !== 'OFF') return undefined;
    let stopped = false;
    let timer;
    let expiration;
    let controller;
    const refresh = async () => {
      const requestStarted = performance.now();
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(`${apiUrl}/api/predictions/restoration`, { signal: controller.signal });
        if (!response.ok) throw new Error('Prediction unavailable');
        const data = await response.json();
        if (stopped) return;
        const receivedAt = performance.now();
        setForecast({ ...data, receivedAt });
        setError(false);
        setExpired(false);
        clearTimeout(expiration);
        if (data.valid_until) {
          const expiresAt = Math.min(Date.parse(data.valid_until),
            data.predicted_restoration ? Date.parse(data.predicted_restoration) : Infinity,
            data.window ? Date.parse(data.window.end) : Infinity);
          // Compare server timestamps with one another; browser clocks can differ.
          expiration = setTimeout(() => setExpired(true), Math.max(0,
            expiresAt - Date.parse(data.generated_at) - (receivedAt - requestStarted)));
        }
      } catch {
        if (!stopped) { setError(true); setForecast(null); }
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(refresh, 60000);
      }
    };
    refresh();
    return () => { stopped = true; clearTimeout(timer); clearTimeout(expiration); controller?.abort(); };
  }, [status, apiUrl]);

  if (status !== 'OFF') return null;
  const active = !error && !expired && forecast?.status === 'active';
  let message = 'Checking when grid power may return…';
  if (error) message = 'Forecast unavailable. Retrying automatically.';
  else if (expired) message = 'Updating the estimated return time…';
  else if (forecast?.status === 'pending') message = 'Waiting to see if this is a brief interruption.';
  else if (forecast?.status === 'insufficient_data') message = 'Not enough past outages to estimate a return time yet.';
  else if (forecast && !active) message = 'Unable to estimate a return time from the available records.';

  return <section aria-label="Power restoration forecast" className="border-b border-slate-200 dark:border-slate-800">
    <div className="p-4 lg:p-5 flex justify-between gap-3 items-center">
      <h3 className="flex items-center gap-2 text-[9px] font-black tracking-widest uppercase text-slate-400 dark:text-slate-500"><Clock size={13} className="text-blue-500 shrink-0" />Grid return estimate</h3>
      {Number.isFinite(forecast?.elapsed_seconds) && <span className="text-[9px] font-bold text-slate-500 tabular-nums whitespace-nowrap"><Elapsed seconds={forecast.elapsed_seconds} receivedAt={forecast.receivedAt} /></span>}
    </div>
    {active ? <>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] divide-x divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
        <div className="p-4 lg:p-5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Most likely return</p>
          <p className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">{clock(forecast.predicted_restoration)}</p>
          <p className="mt-1 text-[9px] font-bold text-slate-500 capitalize">{describeDay(forecast.predicted_restoration, forecast.generated_at)} · WAT</p>
        </div>
        <div className="p-4 lg:p-5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Confidence</p>
          <p className={`mt-1 text-xl font-black ${forecast.confidence === 'moderate' ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-500'}`}>{forecast.confidence === 'moderate' ? 'Moderate' : 'Low'}</p>
          <p className="mt-1 text-[9px] font-bold text-slate-500">{forecast.sample_size} similar outages</p>
        </div>
      </div>
      <div className="p-4 lg:p-5">
        <p className="text-[11px] font-bold leading-relaxed text-slate-600 dark:text-slate-300">Power may return {returnWindow(forecast.window, forecast.generated_at)}.</p>
        <p className="mt-2 text-[9px] text-slate-400 dark:text-slate-500">Based on past outages. Actual return may be earlier or later.</p>
      </div>
    </> : <p role="status" className="px-4 lg:px-5 pb-4 text-[10px] font-bold text-slate-500 dark:text-slate-400">{message}</p>}
  </section>;
}

export default memo(RestorationForecast);
