import { memo, useEffect, useState } from 'react';

const wat = value => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

function Elapsed({ start }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(start)) / 1000));
  return <span>{Math.floor(seconds / 3600)}h {Math.floor(seconds % 3600 / 60)}m elapsed</span>;
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
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(`${apiUrl}/api/predictions/restoration`, { signal: controller.signal });
        if (!response.ok) throw new Error('Prediction unavailable');
        const data = await response.json();
        if (stopped) return;
        setForecast(data);
        setError(false);
        setExpired(false);
        clearTimeout(expiration);
        if (data.valid_until) {
          const expiresAt = Math.min(Date.parse(data.valid_until),
            data.predicted_restoration ? Date.parse(data.predicted_restoration) : Infinity,
            data.window ? Date.parse(data.window.end) : Infinity);
          expiration = setTimeout(() => setExpired(true), Math.max(0, expiresAt - Date.now()));
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
  const windowExpired = active && Date.parse(forecast.window.end) <= Date.now();
  let message = 'Checking historical outage patterns…';
  if (error) message = 'Forecast unavailable. Retrying automatically.';
  else if (expired || windowExpired) message = 'Estimate expired. Waiting for a fresh forecast.';
  else if (forecast?.status === 'pending') message = 'Waiting for a sustained outage. Brief interruptions are excluded.';
  else if (forecast?.status === 'insufficient_data') message = `Not enough comparable outages yet (${forecast.sample_size} available).`;
  else if (forecast && !active) message = 'No reliable forecast available for the current outage.';

  return <section aria-label="Power restoration forecast" className="border-b border-slate-200 dark:border-slate-800 p-4 lg:p-5">
    <div className="flex justify-between gap-3 items-center">
      <h3 className="text-[9px] font-black tracking-[0.18em] uppercase text-slate-500 dark:text-slate-400">Grid restoration forecast</h3>
      {forecast?.outage_start && <span className="text-[9px] text-slate-400"><Elapsed start={forecast.outage_start} /></span>}
    </div>
    {active && !windowExpired ? <>
      <p className="mt-3 text-sm font-bold text-slate-900 dark:text-slate-100">{wat(forecast.window.start)} – {wat(forecast.window.end)} <span className="text-[9px] text-slate-400">WAT</span></p>
      <p className="mt-1 text-[9px] text-slate-500">Median return {wat(forecast.predicted_restoration)} · central 80% historical window</p>
      <div className="grid grid-cols-3 gap-2 mt-4">
        {[1, 2, 4].map(hours => {
          const probability = forecast.probabilities[String(hours)];
          const bounds = probability.interval_95.map(p => `${Math.round(p * 100)}%`).join('–');
          return <div key={hours} title={`95% uncertainty range: ${bounds}`}>
            <p className="text-[9px] uppercase text-slate-400">Within {hours}h</p>
            <p className="text-lg font-black text-blue-600 dark:text-blue-400">{Math.round(probability.value * 100)}%</p>
            <p className="text-[8px] text-slate-500">{bounds}</p>
          </div>;
        })}
      </div>
      <p className="mt-3 text-[9px] text-slate-500">{forecast.confidence === 'moderate' ? 'Moderate' : 'Low'} confidence · {forecast.sample_size} comparable outages</p>
      <p className="mt-1 text-[9px] text-slate-400">Historical estimate, not a guarantee. Generator supply is not grid restoration.</p>
    </> : <p role="status" className="mt-3 text-[10px] text-slate-500 dark:text-slate-400">{message}</p>}
  </section>;
}

export default memo(RestorationForecast);
