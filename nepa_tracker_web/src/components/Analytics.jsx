import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell 
} from 'recharts';
import { 
  TrendingUp, Zap, ZapOff, ShieldCheck, Gauge, ArrowUpRight, Award, 
  ChevronLeft, ChevronRight, ChevronsRight, Battery, Clock, Activity
} from 'lucide-react';

const DAY_MS = 24 * 60 * 60 * 1000;
const QUARTERS = [
  { name: 'Q1', months: [0, 1, 2] },
  { name: 'Q2', months: [3, 4, 5] },
  { name: 'Q3', months: [6, 7, 8] },
  { name: 'Q4', months: [9, 10, 11] }
];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EMPTY_ANALYTICS = {
  trend: [],
  distribution: [],
  kpis: { uptime: '--', grid_hours: '--', outages: '--' }
};
const EMPTY_MONTHLY_STATS = { avg_grid: '--', frequency: '--', uptime: '--' };
const masterCache = new Map();
const monthlyCache = new Map();
let analyticsCacheRevision = sessionStorage.getItem('nepa-analytics-revision') || '';

const syncAnalyticsCacheRevision = () => {
  const currentRevision = sessionStorage.getItem('nepa-analytics-revision') || '';
  if (currentRevision !== analyticsCacheRevision) {
    masterCache.clear();
    monthlyCache.clear();
    analyticsCacheRevision = currentRevision;
  }
};

const masterCacheKey = (date, timeframe) => (
  `master-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${timeframe}`
);

const periodContainsNow = (date, timeframe) => {
  const now = new Date();
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  if (timeframe === 'week') {
    const day = start.getDay() === 0 ? 7 : start.getDay();
    start.setDate(start.getDate() - day + 1);
  } else if (timeframe === 'month') {
    start.setDate(1);
  } else if (timeframe === 'year') {
    start.setMonth(0, 1);
  }

  const end = new Date(start);
  if (timeframe === 'day') end.setDate(end.getDate() + 1);
  if (timeframe === 'week') end.setDate(end.getDate() + 7);
  if (timeframe === 'month') end.setMonth(end.getMonth() + 1);
  if (timeframe === 'year') end.setFullYear(end.getFullYear() + 1);
  return now >= start && now < end;
};

const TooltipStatRow = ({ color, label, val, darkMode }) => (
  <div className="flex items-center justify-between gap-4">
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className={`text-[10px] font-bold uppercase tracking-widest ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>{label}</span>
    </div>
    <span className={`text-xs font-black ${darkMode ? 'text-white' : 'text-slate-800'}`}>{val || 0}h</span>
  </div>
);

const TraceTooltip = ({ active, payload, label, darkMode }) => {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  
  return (
    <div className={`backdrop-blur-md p-3 rounded-xl shadow-2xl border min-w-[120px] ${darkMode ? 'bg-slate-950/90 border-slate-800' : 'bg-white/90 border-slate-200'}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>{label}</p>
      <div className="space-y-1.5">
        <TooltipStatRow color="bg-[#10b981]" label="Grid Supply" val={data.Grid} darkMode={darkMode} />
        <TooltipStatRow color="bg-[#f59e0b]" label="Gen Load" val={data.Gen} darkMode={darkMode} />
      </div>
    </div>
  );
};

export default function Analytics({ darkMode }) {
  const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.140:8000';
  syncAnalyticsCacheRevision();

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewDate, setViewDate] = useState(selectedDate);
  const [timeframe, setTimeframe] = useState('day'); 
  const [viewTimeframe, setViewTimeframe] = useState('day'); 
  const selectedCacheKey = masterCacheKey(selectedDate, timeframe);
  const initialCachedData = masterCache.get(selectedCacheKey);
  const [data, setData] = useState(initialCachedData || EMPTY_ANALYTICS);
  const [loadedCacheKey, setLoadedCacheKey] = useState(initialCachedData ? selectedCacheKey : null);
  const initialMonthlyCacheKey = `monthStats-${selectedDate.getFullYear()}-${selectedDate.getMonth() + 1}`;
  const initialMonthlyStats = monthlyCache.get(initialMonthlyCacheKey);
  const [monthlyStats, setMonthlyStats] = useState(initialMonthlyStats || EMPTY_MONTHLY_STATS);
  const [loadedMonthlyCacheKey, setLoadedMonthlyCacheKey] = useState(initialMonthlyStats ? initialMonthlyCacheKey : null);
  const [initialLoading, setInitialLoading] = useState(() => !initialCachedData);
  const [analyticsError, setAnalyticsError] = useState("");
  const [monthlyError, setMonthlyError] = useState("");

  const masterAbortRef = useRef(null);
  const monthlyAbortRef = useRef(null);
  const masterRequestIdRef = useRef(0);
  const monthlyRequestIdRef = useRef(0);
  const hasRenderedDataRef = useRef(Boolean(initialCachedData));
  const preserveAnalyticsErrorRef = useRef(false);
  const renderedViewRef = useRef({ date: selectedDate, timeframe: 'day' });

  const currentYear = viewDate.getFullYear();
  const currentMonth = viewDate.getMonth() + 1;

  const getFormattedDateRange = () => {
    const d = viewDate;
    if (viewTimeframe === 'day') return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (viewTimeframe === 'month') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (viewTimeframe === 'year') return d.getFullYear().toString();
    if (viewTimeframe === 'week') {
      const start = new Date(d);
      const currentDay = d.getDay() === 0 ? 7 : d.getDay();
      start.setDate(d.getDate() - currentDay + 1);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return `${start.getDate()} ${start.toLocaleDateString('en-GB', {month:'short'})} - ${end.getDate()} ${end.toLocaleDateString('en-GB', {month:'short', year:'numeric'})}`;
    }
  };

  const getChartTitle = () => {
    const titles = { month: 'Daily Uptime Heatmap', year: 'Quarterly Overview', day: 'Day Trace' };
    return titles[activeViewTimeframe] || `${activeViewTimeframe} Aggregate`;
  };

  const adjustDate = (dir) => {
    const d = new Date(viewDate);
    if (viewTimeframe === 'day') d.setDate(d.getDate() + dir);
    if (viewTimeframe === 'week') d.setDate(d.getDate() + (dir * 7));
    if (viewTimeframe === 'month') {
      d.setDate(1); // Prevent date overflow (e.g. Jan 31 -> Feb 31 -> Mar 3)
      d.setMonth(d.getMonth() + dir);
    }
    if (viewTimeframe === 'year') d.setFullYear(d.getFullYear() + dir);
    setSelectedDate(d);
  };

  const handleChartClick = (state) => {
    if (!state || state.activeTooltipIndex === undefined) return;
    if (viewTimeframe === 'week') {
      const startOfWeek = new Date(viewDate);
      const currentDay = viewDate.getDay() === 0 ? 7 : viewDate.getDay();
      startOfWeek.setDate(viewDate.getDate() - currentDay + 1);
      
      const targetDate = new Date(startOfWeek);
      targetDate.setDate(startOfWeek.getDate() + Number(state.activeTooltipIndex));
      targetDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (targetDate > today) return;
      
      setSelectedDate(targetDate);
      setTimeframe('day');
    }
  };

  useEffect(() => {
    const cacheKey = `monthStats-${currentYear}-${currentMonth}`;
    const now = new Date();
    const isCurrentMonth = currentYear === now.getFullYear() && currentMonth === now.getMonth() + 1;
    const cached = monthlyCache.get(cacheKey);

    setMonthlyStats(cached || EMPTY_MONTHLY_STATS);
    setLoadedMonthlyCacheKey(cached ? cacheKey : null);
    setMonthlyError("");
    if (!isCurrentMonth && cached) return;

    const fetchMonthlyStats = async () => {
      if (monthlyAbortRef.current) monthlyAbortRef.current.abort();
      const controller = new AbortController();
      monthlyAbortRef.current = controller;
      const requestId = ++monthlyRequestIdRef.current;
      try {
        const res = await fetch(`${API_URL}/api/analytics/monthly/${currentYear}/${currentMonth}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Monthly summary request failed');
        const json = await res.json();
        if (controller.signal.aborted || requestId !== monthlyRequestIdRef.current) return;
        monthlyCache.set(cacheKey, json);
        setMonthlyStats(json);
        setLoadedMonthlyCacheKey(cacheKey);
        setMonthlyError("");
      } catch {
        if (!controller.signal.aborted && requestId === monthlyRequestIdRef.current) {
          setMonthlyError("Summary update failed");
        }
      }
    };

    fetchMonthlyStats();
    const pollTimer = isCurrentMonth ? setInterval(fetchMonthlyStats, 60000) : null;
    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (monthlyAbortRef.current) monthlyAbortRef.current.abort();
    };
  }, [API_URL, currentYear, currentMonth]);

  useEffect(() => {
    const requestYear = selectedDate.getFullYear();
    const requestMonth = selectedDate.getMonth() + 1;
    const formattedMonth = String(requestMonth).padStart(2, '0');
    const formattedDay = String(selectedDate.getDate()).padStart(2, '0');
    const dateStr = `${requestYear}-${formattedMonth}-${formattedDay}`;
    const cacheKey = masterCacheKey(selectedDate, timeframe);
    const isCurrentPeriod = periodContainsNow(selectedDate, timeframe);
    const cached = masterCache.get(cacheKey);
    const isUncachedNavigation = !cached && hasRenderedDataRef.current;

    if (preserveAnalyticsErrorRef.current) {
      preserveAnalyticsErrorRef.current = false;
    } else {
      setAnalyticsError("");
    }
    if (cached) {
      setData(cached);
      setLoadedCacheKey(cacheKey);
      hasRenderedDataRef.current = true;
      renderedViewRef.current = { date: selectedDate, timeframe };
      setViewTimeframe(timeframe);
      setViewDate(selectedDate);
      setInitialLoading(false);
    } else if (!hasRenderedDataRef.current) {
      setInitialLoading(true);
    }

    if (!isCurrentPeriod && cached) {
      return;
    }

    const fetchMasterData = async () => {
      if (masterAbortRef.current) masterAbortRef.current.abort();
      const controller = new AbortController();
      masterAbortRef.current = controller;
      const requestId = ++masterRequestIdRef.current;
      if (!hasRenderedDataRef.current) setInitialLoading(true);

      try {
        const res = await fetch(`${API_URL}/api/analytics/master?date=${dateStr}&timeframe=${timeframe}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Analytics request failed');
        const json = await res.json();
        if (controller.signal.aborted || requestId !== masterRequestIdRef.current) return;
        masterCache.set(cacheKey, json);
        setData(json);
        setLoadedCacheKey(cacheKey);
        hasRenderedDataRef.current = true;
        renderedViewRef.current = { date: selectedDate, timeframe };
        setViewTimeframe(timeframe);
        setViewDate(selectedDate);
        setAnalyticsError("");
      } catch {
        if (!controller.signal.aborted && requestId === masterRequestIdRef.current) {
          setAnalyticsError(hasRenderedDataRef.current ? "Update failed — showing last successful data" : "Unable to load analytics");
          if (isUncachedNavigation) {
            preserveAnalyticsErrorRef.current = true;
            setSelectedDate(renderedViewRef.current.date);
            setTimeframe(renderedViewRef.current.timeframe);
          }
        }
      } finally {
        if (!controller.signal.aborted && requestId === masterRequestIdRef.current) {
          setInitialLoading(false);
        }
      }
    };

    fetchMasterData();
    const pollTimer = isCurrentPeriod ? setInterval(fetchMasterData, 60000) : null;
    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (masterAbortRef.current) masterAbortRef.current.abort();
    };
  }, [API_URL, selectedDate, timeframe]);

  const activeData = data;
  const currentMonthlyCacheKey = `monthStats-${currentYear}-${currentMonth}`;
  const activeMonthlyStats = loadedMonthlyCacheKey === currentMonthlyCacheKey ? monthlyStats : EMPTY_MONTHLY_STATS;
  const activeViewDate = viewDate;
  const activeViewTimeframe = viewTimeframe;
  const chartTrendData = useMemo(() => activeData.trend || [], [activeData.trend]);

  const { genHours, offHours } = useMemo(() => {
    return {
      genHours: activeData.distribution?.find(d => d.name === 'Gen')?.value || 0,
      offHours: activeData.distribution?.find(d => d.name === 'Off')?.value || 0
    };
  }, [activeData.distribution]);
  const hasAnalyticsData = loadedCacheKey !== null;
  const navigationPending = selectedCacheKey !== loadedCacheKey;

  const heatmapDays = useMemo(() => {
    const viewYear = activeViewDate.getFullYear();
    const viewMonth = activeViewDate.getMonth() + 1;
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();

    return Array.from({ length: daysInMonth }, (_, i) => {
      const dayNum = i + 1;
      const dayData = chartTrendData.find(d => String(d.name) === String(dayNum)) || { Grid: 0, Gen: 0 };
      const grid = dayData.Grid || 0;
      const gen = dayData.Gen || 0;
      const observed = dayData.Observed || 0;
      const off = Math.max(0, observed - (grid + gen));
      const uptime = observed > 0 ? Math.round(((grid + gen) / observed) * 100) : null;
      const cellDate = new Date(viewYear, viewMonth - 1, dayNum);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return { dayNum, grid, gen, off, uptime, isFuture: cellDate > today };
    });
  }, [activeViewDate, chartTrendData]);
  
  const inputDateString = `${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}-${String(viewDate.getDate()).padStart(2,'0')}`;
  const nowForInput = new Date();
  const maxDateString = `${nowForInput.getFullYear()}-${String(nowForInput.getMonth()+1).padStart(2,'0')}-${String(nowForInput.getDate()).padStart(2,'0')}`;
  const forwardDisabled = navigationPending || periodContainsNow(viewDate, viewTimeframe) || viewDate > nowForInput;

  const renderDayTrace = () => {
  const localMidnight = new Date(activeViewDate).setHours(0, 0, 0, 0);

  return (
    <div className="w-full h-full flex flex-col justify-center px-2">
      <div className="relative w-full h-24 sm:h-32 overflow-visible bg-slate-50 dark:bg-slate-900 shadow-inner border border-slate-200 dark:border-slate-800 z-20">
        {chartTrendData.map((point, i) => {
          if (i === chartTrendData.length - 1) return null;

          const durationMs = chartTrendData[i + 1].timestamp - point.timestamp;
          const leftPercent = ((point.timestamp - localMidnight) / DAY_MS) * 100;
          const widthPercent = (durationMs / DAY_MS) * 100;

          const bgColor = point.level === 1 
            ? (point.status === "NEPA" ? "bg-[#10b981]" : "bg-[#f59e0b]") 
            : "bg-slate-300 dark:bg-slate-700";

          return (
            <div
              key={i}
              className={`h-full ${bgColor} absolute group hover:brightness-110 transition-all border-r border-black/10 dark:border-white/5 last:border-0 cursor-pointer`}
              style={{ 
                left: `${leftPercent}%`, 
                width: `${widthPercent}%` 
              }}
            >
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                <div className="backdrop-blur-md p-2 lg:p-3 rounded shadow-2xl border bg-white/95 dark:bg-slate-950/95 border-slate-200 dark:border-slate-800 flex flex-col items-center">
                  <span className={`text-[10px] font-black uppercase tracking-widest ${point.level === 1 ? (point.status === 'NEPA' ? 'text-emerald-500' : 'text-amber-500') : 'text-slate-400'}`}>
                    {point.level === 1 ? point.status : 'OUTAGE'}
                  </span>
                  <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-1">
                    {point.time} - {chartTrendData[i + 1].time}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="relative w-full h-24 mt-3 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest z-10">
        {(() => {
          const tiers = [-20, -20, -20];
          const MIN_DIST = 10;
          const isToday = new Date(activeViewDate).toDateString() === new Date().toDateString();

          const labels = chartTrendData.map((point, i) => {
            const leftPercent = ((point.timestamp - localMidnight) / DAY_MS) * 100;
            const isLast = i === chartTrendData.length - 1;
            let assignedTier = 0;

            if (i === 0 || (isLast && !isToday)) {
              assignedTier = 3;
            } else {
              for (let t = 0; t < 3; t++) if (leftPercent - tiers[t] > MIN_DIST) { assignedTier = t; break; }
              if (assignedTier === 0 && leftPercent - tiers[0] <= MIN_DIST) assignedTier = (i % 3);
              tiers[assignedTier] = leftPercent;
            }

            const topOffset = assignedTier * 20;
            const displayTime = (isLast && isToday) ? "NOW" : point.time;

            return (
              <div key={`time-${i}`} className="absolute hover:z-20 transition-all" style={{ left: `${leftPercent}%`, top: `${topOffset}px` }}>
                <div className="absolute left-0 -translate-x-1/2 bottom-full mb-0.5 w-px bg-slate-300 dark:bg-slate-700 -z-10" style={{ height: `${topOffset + 4}px` }} />
                <div className={`absolute top-0 ${i === 0 ? 'left-0 translate-x-1' : (isLast && !isToday) ? 'right-0 -translate-x-1' : 'left-0 -translate-x-1/2'}`}>
                  <span className={`px-1.5 py-0.5 whitespace-nowrap border block ${isLast && isToday ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'}`}>
                    {displayTime}
                  </span>
                </div>
              </div>
            );
          });

          if (isToday) {
            labels.push(
              <div key="time-end-today" className="absolute hover:z-20 transition-all" style={{ left: `100%`, top: `60px` }}>
                <div className="absolute left-0 -translate-x-1/2 bottom-full mb-0.5 w-px bg-slate-300 dark:bg-slate-700/50 -z-10" style={{ height: `64px` }} />
                <div className="absolute top-0 right-0 -translate-x-1">
                  <span className="bg-slate-50 dark:bg-slate-900/50 px-1.5 py-0.5 whitespace-nowrap border border-slate-200/50 dark:border-slate-800/50 block text-slate-400 dark:text-slate-600">11:59 PM</span>
                </div>
              </div>
            );
          }
          return labels;
        })()}
      </div>
    </div>
  );
};

  const renderMonthHeatmap = () => {
    const viewYear = activeViewDate.getFullYear();
    const viewMonth = activeViewDate.getMonth() + 1;
    const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay();
    const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1;
    const blanks = Array.from({ length: adjustedFirstDay }, (_, i) => i);

    return (
      <div className="w-full h-full flex flex-col">
        <div className="grid grid-cols-7 mb-2">
          {WEEK_DAYS.map(d => <div key={d} className="text-center text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-[1px] bg-slate-200 dark:bg-slate-800 flex-1 border border-slate-200 dark:border-slate-800">
          {blanks.map(b => <div key={`blank-${b}`} className="bg-slate-50 dark:bg-slate-900/50" />)}
          {heatmapDays.map(d => {
            return (
              <div 
                key={d.dayNum} 
                aria-disabled={d.isFuture}
                onClick={() => { if (!d.isFuture) { setSelectedDate(new Date(viewYear, viewMonth - 1, d.dayNum)); setTimeframe('day'); } }}
                className={`bg-white dark:bg-slate-950 p-1.5 flex flex-col justify-between relative group transition-colors ${d.isFuture ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer'}`}
              >
                <span className={`text-[9px] font-black ${darkMode ? 'text-slate-400' : 'text-slate-500'} group-hover:text-emerald-500 transition-colors`}>{d.dayNum}</span>
                <div className="w-full h-1.5 flex overflow-hidden mt-1 opacity-80 group-hover:opacity-100 transition-opacity">
                  <div style={{width: `${(d.grid/24)*100}%`}} className="bg-emerald-500" />
                  <div style={{width: `${(d.gen/24)*100}%`}} className="bg-amber-500" />
                  <div style={{width: `${(d.off/24)*100}%`}} className="bg-slate-200 dark:bg-slate-800" />
                </div>
                <div className="absolute inset-0 z-10 hidden group-hover:flex flex-col items-center justify-center bg-white/95 dark:bg-slate-950/95 backdrop-blur-md shadow-xl border border-slate-200 dark:border-slate-700 p-1 transition-all">
                  <span className="text-[10px] font-black text-slate-800 dark:text-white leading-none">{d.uptime === null ? '--' : `${d.uptime}%`}</span>
                  <span className="text-[7px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Uptime</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderYearQuarters = () => {
    const viewYear = activeViewDate.getFullYear();

    return (
      <div className="w-full flex-1 flex flex-col">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 flex-1">
          {QUARTERS.map(q => (
            <div key={q.name} className="flex flex-col gap-[1px] bg-slate-200 dark:bg-slate-800 flex-1">
              <div className="bg-slate-50 dark:bg-slate-900 p-2">
                 <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 tracking-[0.2em] uppercase">{q.name}</span>
              </div>
              <div className="flex flex-col gap-[1px] flex-1">
                {q.months.map(mIndex => {
                  const mData = chartTrendData[mIndex] || { Grid: 0, Gen: 0 };
                  const totalHours = new Date(viewYear, mIndex + 1, 0).getDate() * 24;
                  const observed = mData.Observed || 0;
                  const off = Math.max(0, observed - ((mData.Grid || 0) + (mData.Gen || 0)));
                  const uptime = observed > 0 ? Math.round((((mData.Grid || 0) + (mData.Gen || 0)) / observed) * 100) : null;
                  const monthStart = new Date(viewYear, mIndex, 1);
                  const currentMonthStart = new Date();
                  currentMonthStart.setDate(1);
                  currentMonthStart.setHours(0, 0, 0, 0);
                  const isFutureMonth = monthStart > currentMonthStart;

                  return (
                    <div
                      key={mIndex}
                      aria-disabled={isFutureMonth}
                      onClick={() => { if (!isFutureMonth) { setSelectedDate(monthStart); setTimeframe('month'); } }}
                      className={`flex-1 bg-white dark:bg-slate-950 p-2 md:p-3 relative group transition-colors flex flex-col justify-center overflow-hidden min-h-[50px] ${isFutureMonth ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer'}`}
                    >
                      <div className="flex items-center justify-between mb-2 relative z-10">
                        <span className={`text-[10px] md:text-xs font-black uppercase tracking-widest ${darkMode ? 'text-slate-400' : 'text-slate-500'} group-hover:text-emerald-500 transition-colors`}>
                          {MONTH_NAMES_SHORT[mIndex]}
                        </span>
                        <span className="text-[10px] md:text-xs font-black text-slate-800 dark:text-white">{uptime === null ? '--' : `${uptime}%`}</span>
                      </div>
                      <div className="w-full h-1.5 flex overflow-hidden opacity-80 group-hover:opacity-100 transition-opacity relative z-10">
                        <div style={{width: `${((mData.Grid || 0)/totalHours)*100}%`}} className="bg-emerald-500" />
                        <div style={{width: `${((mData.Gen || 0)/totalHours)*100}%`}} className="bg-amber-500" />
                        <div style={{width: `${(off/totalHours)*100}%`}} className="bg-slate-200 dark:bg-slate-800" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderWeekBarChart = () => (
    <ResponsiveContainer width="100%" height="100%" debounce={50}>
      <BarChart data={chartTrendData} barSize={24} margin={{ left: -15, top: 10 }} onClick={handleChartClick} style={{ cursor: 'pointer' }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={darkMode ? '#1e293b' : '#e2e8f0'} />
        <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} stroke={darkMode ? '#475569' : '#94a3b8'} />
        
        <YAxis 
          stroke={darkMode ? '#475569' : '#94a3b8'} 
          fontSize={10} 
          axisLine={false} 
          tickLine={false} 
          tickFormatter={(val) => `${val}h`}
          domain={[0, 24]}
          ticks={[0, 6, 12, 18, 24]}
        />
        
        <Tooltip content={<TraceTooltip darkMode={darkMode} />} cursor={{ fill: 'transparent' }} />
        <Bar dataKey="Grid" stackId="a" isAnimationActive={false}>
          {chartTrendData.map((entry, index) => (
            <Cell key={`cell-grid-${index}`} fill="#10b981" radius={0} />
          ))}
        </Bar>
        <Bar dataKey="Gen" stackId="a" fill="#f59e0b" radius={0} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );

 return (
    <div className="pb-10">
      <div className="flex flex-col lg:grid lg:grid-cols-12 bg-slate-200 dark:bg-slate-800 border-y lg:border border-slate-200 dark:border-slate-800 gap-[1px] lg:rounded-xl overflow-hidden">
        
        {/* LEFT COLUMN */}
        <div className="contents lg:flex lg:flex-col lg:col-span-4 lg:gap-[1px]">
          
          <div className="order-1 lg:order-none w-full bg-white dark:bg-[#020617] p-4 lg:p-6">
            <div className="w-full bg-slate-100 dark:bg-slate-900 p-1 flex mb-4 border border-slate-200 dark:border-slate-800">
              {['YEAR', 'MONTH', 'WEEK', 'DAY'].map(tf => (
                <button 
                  key={tf} 
                  disabled={navigationPending}
                  onClick={() => setTimeframe(tf.toLowerCase())} 
                  className={`flex-1 py-1.5 lg:py-1.5 text-[9px] font-black tracking-widest uppercase select-none transition-colors duration-200 active:opacity-50 disabled:cursor-wait ${viewTimeframe === tf.toLowerCase() ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  {tf}
                </button>
              ))}
            </div>
            
            <div className="flex items-center justify-between px-1">
              <button aria-label="Previous period" disabled={navigationPending} onClick={() => adjustDate(-1)} className="p-1.5 text-emerald-500 hover:bg-emerald-500/10 transition-colors active:opacity-50 disabled:opacity-40 disabled:cursor-wait"><ChevronLeft size={18} strokeWidth={3} /></button>
              <label className="relative cursor-pointer flex-1 text-center group mx-2 py-1">
                <input type="date" disabled={navigationPending} max={maxDateString} value={inputDateString} onChange={(e) => { if(e.target.value) { const [y, m, d] = e.target.value.split('-'); e.target.blur(); setTimeout(() => setSelectedDate(new Date(y, m - 1, d)), 10); }}} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-wait" />
                <span className="font-black text-slate-800 dark:text-white text-xs lg:text-sm tracking-tighter group-hover:text-emerald-500 transition-colors select-none">{getFormattedDateRange()}</span>
              </label>
              <button aria-label="Next period" onClick={() => adjustDate(1)} disabled={forwardDisabled} className={`p-1.5 transition-colors ${forwardDisabled ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed' : 'text-emerald-500 hover:bg-emerald-500/10 active:opacity-50'}`}><ChevronRight size={18} strokeWidth={3} /></button>
            </div>

            <button disabled={navigationPending} onClick={() => setSelectedDate(new Date())} className="w-full mt-3 flex items-center justify-center gap-1 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-500 select-none transition-colors disabled:opacity-50 disabled:cursor-wait"><ChevronsRight size={12} /> Jump to Present</button>
          </div>

          <div className="order-3 lg:order-none w-full bg-white dark:bg-[#020617] p-6 lg:p-8 flex-1 flex flex-col justify-center relative overflow-hidden group min-h-[180px]">
              <ShieldCheck size={120} className="absolute -right-6 -bottom-6 opacity-5 text-slate-900 dark:text-white" />
              <h4 className="text-slate-400 dark:text-slate-500 text-[9px] font-black tracking-[0.2em] uppercase mb-1.5 relative z-10">{activeViewTimeframe} Reliability</h4>
              <p className="text-slate-900 dark:text-white text-5xl font-black relative z-10">
                {activeData.kpis.uptime}
              </p>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1 mt-6 overflow-hidden relative z-10"><div className="bg-emerald-500 h-full transition-all duration-1000" style={{ width: activeData.kpis.uptime }} /></div>
          </div>

          <div className="order-5 lg:order-none w-full grid grid-cols-2 gap-[1px] bg-slate-200 dark:bg-slate-800">
            <div className="bg-white dark:bg-[#020617] p-4 lg:p-5 relative overflow-hidden flex flex-col justify-center">
              <Gauge className="text-emerald-500 mb-2" size={16} />
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Avg Grid</p>
              <h4 className="text-lg font-black text-slate-900 dark:text-white leading-none">{activeMonthlyStats.avg_grid}</h4>
            </div>
            <div className="bg-white dark:bg-[#020617] p-4 lg:p-5 relative overflow-hidden flex flex-col justify-center">
              <TrendingUp className="text-rose-500 mb-2" size={16} />
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Avg Outages/Day</p>
              <h4 className="text-lg font-black text-slate-900 dark:text-white leading-none">{activeMonthlyStats.frequency}</h4>
              {monthlyError && <p role="alert" className="text-[8px] font-bold text-red-500 mt-1">{monthlyError}</p>}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="contents lg:flex lg:flex-col lg:col-span-8 lg:gap-[1px]">
          
          <div className="order-4 lg:order-none w-full grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-slate-200 dark:bg-slate-800">
            {[
              {label: 'Grid Supply', val: activeData.kpis.grid_hours, icon: Zap, color: 'text-emerald-500'},
              {label: 'Outage Events', val: activeData.kpis.outages, icon: ZapOff, color: 'text-rose-500'},
              {label: 'Gen Load', val: hasAnalyticsData ? genHours + 'h' : '--', icon: Battery, color: 'text-amber-500'},
              {label: 'Downtime', val: hasAnalyticsData ? offHours + 'h' : '--', icon: Clock, color: 'text-slate-400 dark:text-slate-500'},
            ].map((m, i) => (
              <div key={i} className="bg-white dark:bg-[#020617] p-5 lg:p-6 relative overflow-hidden">
                <m.icon size={20} className={`${m.color} mb-3`} />
                <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{m.label}</p>
                <h4 className="text-xl font-black text-slate-900 dark:text-white mt-1">
                  {m.val}
                </h4>
              </div>
            ))}
          </div>

          <div className="order-2 lg:order-none w-full bg-white dark:bg-[#020617] p-6 lg:p-8 flex flex-col flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <div>
                <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-white leading-none">{getChartTitle()}</h3>
                {analyticsError && <p role="alert" className="text-[9px] font-bold text-red-500 mt-1">{analyticsError}</p>}
              </div>
              <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-1.5 self-start sm:self-auto">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-[#10b981]" /><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Grid</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-[#f59e0b]" /><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Gen</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-slate-300 dark:bg-slate-700" /><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">No Power</span></div>
              </div>
            </div>
            
            <div className={`w-full relative ${activeViewTimeframe === 'year' ? 'flex flex-col flex-1 min-h-[320px] pb-2' : activeViewTimeframe === 'month' ? 'h-[320px]' : 'h-[280px]'}`}>
              {initialLoading && !hasAnalyticsData && (
                <div role="status" aria-live="polite" className="absolute inset-0 z-50 flex items-center justify-center bg-white dark:bg-[#020617] text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  Loading analytics...
                </div>
              )}
              {activeViewTimeframe === 'day' && renderDayTrace()}
              {activeViewTimeframe === 'week' && renderWeekBarChart()}
              {activeViewTimeframe === 'month' && renderMonthHeatmap()}
              {activeViewTimeframe === 'year' && renderYearQuarters()}
            </div>
          </div>
          
        </div>

      </div>
    </div>
  );
}
