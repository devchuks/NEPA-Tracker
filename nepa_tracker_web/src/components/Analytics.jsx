import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell 
} from 'recharts';
import { 
  TrendingUp, Zap, ZapOff, ShieldCheck, Gauge, ArrowUpRight, Award, 
  ChevronLeft, ChevronRight, ChevronsRight, Battery, Clock, Activity 
} from 'lucide-react';

// --- CONSTANTS OUTSIDE COMPONENT TO PREVENT RE-CREATION ---
const DAY_MS = 24 * 60 * 60 * 1000;
const QUARTERS = [
  { name: 'Q1', months: [0, 1, 2] },
  { name: 'Q2', months: [3, 4, 5] },
  { name: 'Q3', months: [6, 7, 8] },
  { name: 'Q4', months: [9, 10, 11] }
];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewDate, setViewDate] = useState(new Date());
  const [timeframe, setTimeframe] = useState('day'); 
  const [viewTimeframe, setViewTimeframe] = useState('day'); 
  const [data, setData] = useState({
    trend: [], distribution: [], kpis: { uptime: '0%', grid_hours: '0h', outages: '0' }
  });
  const [monthlyStats, setMonthlyStats] = useState({ avg_grid: '--', frequency: '--', uptime: '--' });
  const [streak, setStreak] = useState({ hours: '0', start: '...', end: '...' });

  const cache = useRef({});
  const abortControllerRef = useRef(null);

  const currentYear = selectedDate.getFullYear();
  const currentMonth = selectedDate.getMonth() + 1;

  const getFormattedDateRange = () => {
    const d = selectedDate;
    if (timeframe === 'day') return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (timeframe === 'month') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    if (timeframe === 'year') return d.getFullYear().toString();
    if (timeframe === 'week') {
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
    return titles[viewTimeframe] || `${viewTimeframe} Aggregate`;
  };

  const adjustDate = (dir) => {
    const d = new Date(selectedDate);
    if (timeframe === 'day') d.setDate(d.getDate() + dir);
    if (timeframe === 'week') d.setDate(d.getDate() + (dir * 7));
    if (timeframe === 'month') d.setMonth(d.getMonth() + dir);
    if (timeframe === 'year') d.setFullYear(d.getFullYear() + dir);
    setSelectedDate(d);
  };

  const handleChartClick = (state) => {
    if (!state || state.activeTooltipIndex === undefined) return;
    if (viewTimeframe === 'week') {
      const startOfWeek = new Date(selectedDate);
      const currentDay = selectedDate.getDay() === 0 ? 7 : selectedDate.getDay();
      startOfWeek.setDate(selectedDate.getDate() - currentDay + 1);
      
      const targetDate = new Date(startOfWeek);
      targetDate.setDate(startOfWeek.getDate() + Number(state.activeTooltipIndex));
      
      setSelectedDate(targetDate);
      setTimeframe('day');
    }
  };

  useEffect(() => {
    fetch(`${API_URL}/api/analytics/streak`)
      .then(res => res.json())
      .then(setStreak).catch(e => console.error("Streak Sync Error:", e));
  }, []);

  useEffect(() => {
    const cacheKey = `monthStats-${currentYear}-${currentMonth}`;
    if (cache.current[cacheKey]) return setMonthlyStats(cache.current[cacheKey]);
    
    fetch(`${API_URL}/api/analytics/monthly/${currentYear}/${currentMonth}`)
      .then(res => res.json())
      .then(json => { cache.current[cacheKey] = json; setMonthlyStats(json); })
      .catch(e => console.error("Monthly Sync Error:", e));
  }, [currentYear, currentMonth]);

  useEffect(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const formattedMonth = String(currentMonth).padStart(2, '0');
    const formattedDay = String(selectedDate.getDate()).padStart(2, '0');
    const dateStr = `${currentYear}-${formattedMonth}-${formattedDay}`;
    const cacheKey = `master-${dateStr}-${timeframe}`;
    const isToday = new Date(selectedDate).toDateString() === new Date().toDateString();

    if (!isToday && cache.current[cacheKey]) {
      setData(cache.current[cacheKey]);
      setViewTimeframe(timeframe);
      setViewDate(selectedDate);
      return;
    }

    const fetchMasterData = async () => {
      try {
        const res = await fetch(`${API_URL}/api/analytics/master?date=${dateStr}&timeframe=${timeframe}`, { signal });
        const json = await res.json();
        if (!signal.aborted) {
          cache.current[cacheKey] = json;
          setData(json);
          setViewTimeframe(timeframe);
          setViewDate(selectedDate); 
        }
      } catch (error) {
        if (error.name !== 'AbortError') console.error("Master Sync Error:", error);
      }
    };

    const debounceTimer = setTimeout(() => fetchMasterData(), 300);
    let pollTimer;
    if (isToday) pollTimer = setInterval(() => fetchMasterData(), 60000); 

    return () => {
      clearTimeout(debounceTimer);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [selectedDate, timeframe, currentYear, currentMonth]);

  const chartTrendData = useMemo(() => data?.trend || [], [data?.trend]);
  const genHours = data.distribution?.find(d => d.name === 'Gen')?.value || 0;
  const offHours = data.distribution?.find(d => d.name === 'Off')?.value || 0;
  
  const inputDateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth()+1).padStart(2,'0')}-${String(selectedDate.getDate()).padStart(2,'0')}`;

  const renderDayTrace = () => (
    <div className="w-full h-full flex flex-col justify-center px-2">
      <div className="relative w-full h-24 sm:h-32 overflow-visible bg-slate-50 dark:bg-slate-900 shadow-inner flex border border-slate-200 dark:border-slate-800 z-20">
        {chartTrendData.map((point, i) => {
          if (i === chartTrendData.length - 1) return null; 
          const durationMs = chartTrendData[i + 1].timestamp - point.timestamp;
          const bgColor = point.level === 1 ? (point.status === "NEPA" ? "bg-[#10b981]" : "bg-[#f59e0b]") : "bg-transparent";

          return (
            <div 
              key={i} 
              className={`h-full ${bgColor} relative group hover:brightness-110 transition-all border-r border-black/10 dark:border-white/5 last:border-0 cursor-pointer`}
              style={{ width: `${(durationMs / DAY_MS) * 100}%` }}
            >
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                 <div className="backdrop-blur-md p-2 lg:p-3 rounded shadow-2xl border bg-white/95 dark:bg-slate-950/95 border-slate-200 dark:border-slate-800 flex flex-col items-center">
                   <span className={`text-[10px] font-black uppercase tracking-widest ${point.level === 1 ? (point.status === 'NEPA' ? 'text-emerald-500' : 'text-amber-500') : 'text-slate-400'}`}>
                     {point.level === 1 ? point.status : 'OUTAGE'}
                   </span>
                   <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-1">{point.time} - {chartTrendData[i + 1].time}</span>
                 </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="relative w-full h-24 mt-3 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest z-10">
        {(() => {
          const startOfDay = chartTrendData[0]?.timestamp;
          if (!startOfDay) return null;
          
          const tiers = [-20, -20, -20]; 
          const MIN_DIST = 10; 
          const isToday = new Date(viewDate).toDateString() === new Date().toDateString();
          
          const labels = chartTrendData.map((point, i) => {
            const leftPercent = ((point.timestamp - startOfDay) / DAY_MS) * 100;
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

  const renderMonthHeatmap = () => {
    const viewYear = viewDate.getFullYear();
    const viewMonth = viewDate.getMonth() + 1;
    const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay();
    const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    
    const blanks = Array.from({ length: adjustedFirstDay }, (_, i) => i);
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const dayNum = i + 1;
      const dayData = chartTrendData.find(d => String(d.name) === String(dayNum)) || { Grid: 0, Gen: 0 };
      const grid = dayData.Grid || 0;
      const gen = dayData.Gen || 0;
      const off = Math.max(0, 24 - (grid + gen));
      const uptime = Math.round(((grid + gen) / 24) * 100);
      return { dayNum, grid, gen, off, uptime };
    });

    return (
      <div className="w-full h-full flex flex-col">
        <div className="grid grid-cols-7 mb-2">
          {WEEK_DAYS.map(d => <div key={d} className="text-center text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-[1px] bg-slate-200 dark:bg-slate-800 flex-1 border border-slate-200 dark:border-slate-800">
          {blanks.map(b => <div key={`blank-${b}`} className="bg-slate-50 dark:bg-slate-900/50" />)}
          {days.map(d => {
            return (
              <div 
                key={d.dayNum} 
                onClick={() => { setSelectedDate(new Date(viewYear, viewMonth - 1, d.dayNum)); setTimeframe('day'); }}
                className="bg-white dark:bg-slate-950 p-1.5 flex flex-col justify-between relative group hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
              >
                <span className={`text-[9px] font-black ${darkMode ? 'text-slate-400' : 'text-slate-500'} group-hover:text-emerald-500 transition-colors`}>{d.dayNum}</span>
                <div className="w-full h-1.5 flex overflow-hidden mt-1 opacity-80 group-hover:opacity-100 transition-opacity">
                  <div style={{width: `${(d.grid/24)*100}%`}} className="bg-emerald-500" />
                  <div style={{width: `${(d.gen/24)*100}%`}} className="bg-amber-500" />
                  <div style={{width: `${(d.off/24)*100}%`}} className="bg-slate-200 dark:bg-slate-800" />
                </div>
                <div className="absolute inset-0 z-10 hidden group-hover:flex flex-col items-center justify-center bg-white/95 dark:bg-slate-950/95 backdrop-blur-md shadow-xl border border-slate-200 dark:border-slate-700 p-1 transition-all">
                  <span className="text-[10px] font-black text-slate-800 dark:text-white leading-none">{d.uptime}%</span>
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
    const viewYear = viewDate.getFullYear();

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
                  const off = Math.max(0, totalHours - ((mData.Grid || 0) + (mData.Gen || 0)));
                  const uptime = Math.round((((mData.Grid || 0) + (mData.Gen || 0)) / totalHours) * 100) || 0;

                  return (
                    <div
                      key={mIndex}
                      onClick={() => { setSelectedDate(new Date(viewYear, mIndex, 1)); setTimeframe('month'); }}
                      className="flex-1 bg-white dark:bg-slate-950 p-2 md:p-3 relative group hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer flex flex-col justify-center overflow-hidden min-h-[50px]"
                    >
                      <div className="flex items-center justify-between mb-2 relative z-10">
                        <span className={`text-[10px] md:text-xs font-black uppercase tracking-widest ${darkMode ? 'text-slate-400' : 'text-slate-500'} group-hover:text-emerald-500 transition-colors`}>
                          {MONTH_NAMES_SHORT[mIndex]}
                        </span>
                        <span className="text-[10px] md:text-xs font-black text-slate-800 dark:text-white">{uptime}%</span>
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
        
        {/* FIXED: Strict 0 to 24 domain with explicit 6-hour interval ticks */}
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
                  onClick={() => setTimeframe(tf.toLowerCase())} 
                  className={`flex-1 py-1.5 lg:py-1.5 text-[9px] font-black tracking-widest uppercase select-none transition-colors duration-200 active:opacity-50 ${timeframe === tf.toLowerCase() ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  {tf}
                </button>
              ))}
            </div>
            
            <div className="flex items-center justify-between px-1">
              <button onClick={() => adjustDate(-1)} className="p-1.5 text-emerald-500 hover:bg-emerald-500/10 transition-colors active:opacity-50"><ChevronLeft size={18} strokeWidth={3} /></button>
              <label className="relative cursor-pointer flex-1 text-center group mx-2 py-1">
                <input type="date" value={inputDateString} onChange={(e) => { if(e.target.value) { const [y, m, d] = e.target.value.split('-'); e.target.blur(); setTimeout(() => setSelectedDate(new Date(y, m - 1, d)), 10); }}} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                <span className="font-black text-slate-800 dark:text-white text-xs lg:text-sm tracking-tighter group-hover:text-emerald-500 transition-colors select-none">{getFormattedDateRange()}</span>
              </label>
              <button onClick={() => adjustDate(1)} disabled={selectedDate >= new Date()} className={`p-1.5 transition-colors ${selectedDate >= new Date() ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed' : 'text-emerald-500 hover:bg-emerald-500/10 active:opacity-50'}`}><ChevronRight size={18} strokeWidth={3} /></button>
            </div>

            <button onClick={() => setSelectedDate(new Date())} className="w-full mt-3 flex items-center justify-center gap-1 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-500 select-none transition-colors"><ChevronsRight size={12} /> Jump to Present</button>
          </div>

          <div className="order-3 lg:order-none w-full bg-white dark:bg-[#020617] p-6 lg:p-8 flex-1 flex flex-col justify-center relative overflow-hidden group min-h-[180px]">
              <ShieldCheck size={120} className="absolute -right-6 -bottom-6 opacity-5 text-slate-900 dark:text-white" />
              <h4 className="text-slate-400 dark:text-slate-500 text-[9px] font-black tracking-[0.2em] uppercase mb-1.5 relative z-10">{viewTimeframe} Reliability</h4>
              <p className="text-slate-900 dark:text-white text-5xl font-black relative z-10">{data.kpis.uptime}</p>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1 mt-6 overflow-hidden relative z-10"><div className="bg-emerald-500 h-full transition-all duration-1000" style={{ width: data.kpis.uptime }} /></div>
          </div>

          <div className="order-5 lg:order-none w-full grid grid-cols-3 gap-[1px] bg-slate-200 dark:bg-slate-800">
            <div className="bg-white dark:bg-[#020617] p-4 lg:p-5 relative overflow-hidden flex flex-col justify-center">
              <Gauge className="text-emerald-500 mb-2" size={16} />
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Avg Grid</p>
              <h4 className="text-lg font-black text-slate-900 dark:text-white leading-none">{monthlyStats.avg_grid}</h4>
            </div>
            <div className="bg-white dark:bg-[#020617] p-4 lg:p-5 relative overflow-hidden flex flex-col justify-center">
              <TrendingUp className="text-rose-500 mb-2" size={16} />
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Freq/Mon</p>
              <h4 className="text-lg font-black text-slate-900 dark:text-white leading-none">{monthlyStats.frequency}</h4>
            </div>
            <div className="bg-white dark:bg-[#020617] p-4 lg:p-5 relative overflow-hidden flex flex-col justify-center">
              <Award className="text-amber-500 mb-2" size={16} />
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Peak Streak</p>
              <h4 className="text-lg font-black text-slate-900 dark:text-white leading-none">{streak.hours}h</h4>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="contents lg:flex lg:flex-col lg:col-span-8 lg:gap-[1px]">
          
          <div className="order-4 lg:order-none w-full grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-slate-200 dark:bg-slate-800">
            {[
              {label: 'Grid Supply', val: data.kpis.grid_hours, icon: Zap, color: 'text-emerald-500'},
              {label: 'Outage Events', val: data.kpis.outages, icon: ZapOff, color: 'text-rose-500'},
              {label: 'Gen Load', val: genHours + 'h', icon: Battery, color: 'text-amber-500'},
              {label: 'Downtime', val: offHours + 'h', icon: Clock, color: 'text-slate-400 dark:text-slate-500'},
            ].map((m, i) => (
              <div key={i} className="bg-white dark:bg-[#020617] p-5 lg:p-6 relative overflow-hidden">
                <m.icon size={20} className={`${m.color} mb-3`} />
                <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{m.label}</p>
                <h4 className="text-xl font-black text-slate-900 dark:text-white mt-1">{m.val}</h4>
              </div>
            ))}
          </div>

          <div className="order-2 lg:order-none w-full bg-white dark:bg-[#020617] p-6 lg:p-8 flex flex-col flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-white leading-none">
                {getChartTitle()}
              </h3>
              <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-1.5 self-start sm:self-auto">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-[#10b981]" /><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Grid</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-[#f59e0b]" /><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Gen</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-slate-200 dark:bg-slate-800" /><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">No Power</span></div>
              </div>
            </div>
            
            <div className={`w-full ${viewTimeframe === 'year' ? 'flex flex-col flex-1 min-h-[320px] pb-2' : viewTimeframe === 'month' ? 'h-[320px]' : 'h-[280px]'}`}>
              {viewTimeframe === 'day' && renderDayTrace()}
              {viewTimeframe === 'week' && renderWeekBarChart()}
              {viewTimeframe === 'month' && renderMonthHeatmap()}
              {viewTimeframe === 'year' && renderYearQuarters()}
            </div>
          </div>
          
        </div>

      </div>
    </div>
  );
}