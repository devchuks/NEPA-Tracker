import { useState, useEffect, useRef } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { Activity, Calendar as CalendarIcon, ZapOff, Zap, Clock, Info, Sun, Moon, LoaderCircle } from 'lucide-react'
import AuthModal from './components/AuthModal' // <-- IMPORTED NEW COMPONENT
import Analytics from './components/Analytics'
import History from './components/History'

const DAY_MS = 24 * 60 * 60 * 1000;

const formatFullDate = (timestamp) => {
  const date = new Date(timestamp.endsWith('Z') ? timestamp : timestamp + 'Z');
  const day = date.getDate();
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const year = date.getFullYear();
  
  let ordinal = 'th';
  if (day === 1 || day === 21 || day === 31) ordinal = 'st';
  else if (day === 2 || day === 22) ordinal = 'nd';
  else if (day === 3 || day === 23) ordinal = 'rd';

  return `${month} ${day}${ordinal} ${year}`;
};

const getRelativeDay = (timestamp) => {
  const date = new Date(timestamp).toDateString();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  
  if (date === today) return "TODAY";
  if (date === yesterday) return "YESTERDAY";
  return "";
}

function App() {
  const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.140:8000';

  const [status, setStatus] = useState(() => localStorage.getItem('nepa-status'));
  const [powerSource, setPowerSource] = useState(() => localStorage.getItem('nepa-source'));
  const [eventsToday, setEventsToday] = useState(() => {
    const cached = localStorage.getItem('nepa-events-today');
    if (cached === null) return null;
    const value = Number(cached);
    return Number.isFinite(value) ? value : null;
  });
  const [logs, setLogs] = useState(() => {
    const cached = localStorage.getItem('nepa-logs');
    if (!cached) return [];
    try {
      const parsed = JSON.parse(cached);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      localStorage.removeItem('nepa-logs');
      return [];
    }
  });
  const [statusError, setStatusError] = useState("");
  const [logsError, setLogsError] = useState("");
  const [showDashboardSpinner, setShowDashboardSpinner] = useState(false);
  const dashboardAbortRef = useRef(null);
  const dashboardRequestIdRef = useRef(0);
  const dashboardSpinnerTimerRef = useRef(null);
  const dashboardSpinnerVisibleRef = useRef(false);
  
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('nepa-dark-mode');
    try {
      return saved !== null ? JSON.parse(saved) : true;
    } catch (e) {
      return true;
    }
  });

  const [todayTrend, setTodayTrend] = useState([]);

  // --- PREMIUM AUTH STATES ---
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [pendingSource, setPendingSource] = useState(null);
  const [sourcePending, setSourcePending] = useState(false);
  const [showSourcePending, setShowSourcePending] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const sourcePendingRef = useRef(false);

  const location = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (!sourcePending) {
      setShowSourcePending(false);
      return;
    }
    const timer = setTimeout(() => setShowSourcePending(true), 450);
    return () => clearTimeout(timer);
  }, [sourcePending]);

  const fetchData = async () => {
    if (dashboardAbortRef.current) dashboardAbortRef.current.abort();
    const controller = new AbortController();
    dashboardAbortRef.current = controller;
    const requestId = ++dashboardRequestIdRef.current;

    if (dashboardSpinnerTimerRef.current) clearTimeout(dashboardSpinnerTimerRef.current);
    if (!dashboardSpinnerVisibleRef.current) {
      dashboardSpinnerTimerRef.current = setTimeout(() => {
        if (requestId !== dashboardRequestIdRef.current || controller.signal.aborted) return;
        dashboardSpinnerVisibleRef.current = true;
        setShowDashboardSpinner(true);
      }, 175);
    }

    const statusRequest = async () => {
      try {
        const response = await fetch(`${API_URL}/api/status`, { signal: controller.signal });
        if (!response.ok) throw new Error('Status request failed');
        const data = await response.json();
        if (controller.signal.aborted) return;
        setStatus(data.nepa);
        setPowerSource(data.source);
        setEventsToday(data.events_today ?? 0);
        localStorage.setItem('nepa-status', data.nepa);
        localStorage.setItem('nepa-source', data.source);
        localStorage.setItem('nepa-events-today', String(data.events_today ?? 0));
        setStatusError("");
      } catch {
        if (!controller.signal.aborted) setStatusError("Live status unavailable");
      }
    };

    const logsRequest = async () => {
      try {
        const response = await fetch(`${API_URL}/api/logs`, { signal: controller.signal });
        if (!response.ok) throw new Error('Recent activity request failed');
        const data = await response.json();
        if (controller.signal.aborted) return;
        setLogs(data);
        localStorage.setItem('nepa-logs', JSON.stringify(data));
        setLogsError("");
      } catch {
        if (!controller.signal.aborted) setLogsError("Recent activity unavailable");
      }
    };

    await Promise.allSettled([statusRequest(), logsRequest()]);
    if (requestId === dashboardRequestIdRef.current) {
      if (dashboardSpinnerTimerRef.current) clearTimeout(dashboardSpinnerTimerRef.current);
      dashboardSpinnerTimerRef.current = null;
      dashboardSpinnerVisibleRef.current = false;
      setShowDashboardSpinner(false);
    }
  }

  const fetchTodayAnalytics = async () => {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const todayStr = `${year}-${month}-${day}`;

      const res = await fetch(`${API_URL}/api/analytics/master?date=${todayStr}&timeframe=day`);
      if (!res.ok) throw new Error('Analytics request failed');
      const data = await res.json();
      setTodayTrend(data.trend || []);
    } catch (e) {
      // Silenced for production
    }
  };

  useEffect(() => {
    fetchData();
    fetchTodayAnalytics();

    const fastInterval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, 60000); 

    const slowInterval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchTodayAnalytics();
    }, 60000); 

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchData();
        fetchTodayAnalytics();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(fastInterval);
      clearInterval(slowInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (dashboardAbortRef.current) dashboardAbortRef.current.abort();
      if (dashboardSpinnerTimerRef.current) clearTimeout(dashboardSpinnerTimerRef.current);
    };
  }, []);

  // --- PREMIUM AUTH FLOW ---
  const handleSourceChange = (newSource) => {
    if (sourcePendingRef.current || newSource === powerSource) return;
    const token = localStorage.getItem("adminToken");
    setAuthError(""); // Clear any old errors
    setSourceError("");
    if (!token) {
      setPendingSource(newSource);
      setIsAuthModalOpen(true);
      return;
    }
    executeSourceChange(newSource, token);
  };

  const executeSourceChange = async (newSource, token) => {
    if (sourcePendingRef.current) return;
    sourcePendingRef.current = true;
    setSourcePending(true);
    setSourceError("");
    try {
      const res = await fetch(`${API_URL}/api/source`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': token
        },
        body: JSON.stringify({ source: newSource })
      });

      if (res.status === 403) {
        localStorage.removeItem("adminToken");
        setAuthError("Invalid or expired password");
        setPendingSource(newSource);
        setIsAuthModalOpen(true);
      } else if (res.ok) {
        setAuthError("");
        setIsAuthModalOpen(false);
        setPowerSource(newSource);
        setPendingSource(null);
        sessionStorage.setItem('nepa-analytics-revision', String(Date.now()));
        await fetchData();
      } else {
        setSourceError("Unable to change source. Please try again.");
      }
    } catch {
      setSourceError("Unable to change source. Check the connection and retry.");
    } finally {
      sourcePendingRef.current = false;
      setSourcePending(false);
    }
  };

  const submitPassword = (token) => {
    localStorage.setItem("adminToken", token);
    if (pendingSource) executeSourceChange(pendingSource, token);
  };

  const toggleDarkMode = () => {
    const nextMode = !darkMode;
    setDarkMode(nextMode);
    localStorage.setItem('nepa-dark-mode', JSON.stringify(nextMode));
  };

  const displayStatus = status || (statusError ? 'UNAVAILABLE' : '--');
  const lastUpdate = logs.length > 0
    ? new Date(logs[0].timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '--:--';

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-50 dark:bg-[#020617] text-slate-900 dark:text-slate-200 font-sans selection:bg-blue-500/30 transition-colors duration-500">
        
        <nav className="w-full border-b border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-[#020617]/80 backdrop-blur-xl sticky top-0 z-50 transition-all">
          <div className="max-w-[1600px] mx-auto flex justify-between items-center p-2 px-4 lg:p-3 lg:px-6">
            <div className="flex items-center gap-2 lg:gap-3">
              <div className="p-1.5 lg:p-2 bg-blue-100 dark:bg-blue-600/20 border border-blue-200 dark:border-blue-500/30">
                <Activity className="text-blue-600 dark:text-blue-400" size={16} lg:size={20} />
              </div>
              <div>
                <h1 className="text-base lg:text-lg font-black tracking-tighter text-slate-900 dark:text-white leading-none uppercase">NEPA TRACKER</h1>
                <p className="hidden sm:block text-[9px] font-bold tracking-[0.3em] text-blue-600 dark:text-blue-500 uppercase mt-1">Real-Time Monitor</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 lg:gap-3">
              <span className="w-4 h-4 flex items-center justify-center shrink-0" aria-hidden={!(showDashboardSpinner && location.pathname === '/')}>
                {showDashboardSpinner && location.pathname === '/' && <LoaderCircle aria-label="Refreshing live data" className="animate-spin text-blue-500" size={14} />}
              </span>
              <button aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleDarkMode} className="p-2 bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:opacity-80 transition-opacity">
                {darkMode ? <Sun size={14} /> : <Moon size={14} />}
              </button>
              
              <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 p-1 border border-slate-200 dark:border-slate-800">
                <Link to="/" className={`px-3 lg:px-5 py-1.5 lg:py-2 text-[10px] lg:text-xs font-bold ${location.pathname === '/' ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Dashboard</Link>
                <Link to="/calendar" className={`px-3 lg:px-5 py-1.5 lg:py-2 text-[10px] lg:text-xs font-bold ${location.pathname === '/calendar' ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Analytics</Link>
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-[1600px] mx-auto p-4 lg:p-8">
          <Routes>
            <Route path="/" element={
              <div className="relative grid grid-cols-1 lg:grid-cols-12 bg-white dark:bg-[#020617] border-y lg:border border-slate-200 dark:border-slate-800 lg:rounded-xl overflow-hidden shadow-xl dark:shadow-2xl">
                {/* LEFT COLUMN */}
                <div className="lg:col-span-4 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800">
                  
                  {/* STATUS CARD */}
                  <div className={`p-6 lg:p-8 transition-all duration-1000 relative overflow-hidden flex flex-col items-center justify-center min-h-[260px] border-b border-slate-200 dark:border-slate-800 ${
                    displayStatus === 'ON' ? 'bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-900/10 dark:via-[#020617] dark:to-[#020617]' :
                    displayStatus === 'OFF' ? 'bg-gradient-to-br from-slate-100 to-white dark:from-slate-800/20 dark:via-[#020617] dark:to-[#020617]' :
                    displayStatus === 'UNAVAILABLE' ? 'bg-gradient-to-br from-red-50 to-white dark:from-red-900/10 dark:via-[#020617] dark:to-[#020617]' :
                    'bg-gradient-to-br from-slate-50 to-white dark:from-slate-900/30 dark:via-[#020617] dark:to-[#020617]'
                  }`}>
                    <div className="absolute top-0 right-0 p-6 opacity-5">
                      <Zap size={100} className={displayStatus === 'ON' ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-600'} />
                    </div>
                    
                    <p className="text-slate-400 dark:text-slate-500 mb-3 font-black tracking-[0.3em] text-[9px] uppercase relative z-10">Live Connection Status</p>
                    <h2 className={`text-5xl font-black tracking-tighter transition-all relative z-10 ${
                      displayStatus === 'ON' ? 'text-emerald-500 dark:text-emerald-400 drop-shadow-[0_0_15px_rgba(16,185,129,0.2)]' :
                      displayStatus === 'OFF' ? 'text-slate-400 dark:text-slate-600' :
                      displayStatus === 'UNAVAILABLE' ? 'text-red-500 dark:text-red-400' :
                      'text-slate-400 dark:text-slate-600'
                    }`}>
                      {displayStatus}
                    </h2>
                    {statusError && status !== null && (
                      <p role="alert" className="mt-2 text-center text-[9px] font-bold text-red-500 relative z-10">Refresh failed — showing last verified status</p>
                    )}
                    
                    <div className="mt-6 w-full max-w-[240px] relative z-10">
                      <p className="text-center text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Source Override</p>
                      <div className="flex bg-slate-100 dark:bg-slate-900 p-1 border border-slate-200 dark:border-slate-800 rounded-xl">
                        <button disabled={sourcePending || !powerSource} aria-pressed={powerSource === 'NEPA'} onClick={() => handleSourceChange('NEPA')} className={`flex-1 py-2 text-[9px] font-black tracking-widest transition-all duration-500 rounded-lg disabled:opacity-50 ${powerSource === 'NEPA' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white dark:hover:bg-slate-800'}`}>NEPA</button>
                        <button disabled={sourcePending || !powerSource} aria-pressed={powerSource === 'GEN'} onClick={() => handleSourceChange('GEN')} className={`flex-1 py-2 text-[9px] font-black tracking-widest transition-all duration-500 rounded-lg disabled:opacity-50 ${powerSource === 'GEN' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:bg-white dark:hover:bg-slate-800'}`}>GEN</button>
                      </div>
                      {showSourcePending && <p role="status" aria-live="polite" className="mt-2 text-center text-[9px] font-bold uppercase tracking-widest text-blue-500">Applying source...</p>}
                      {sourceError && <p role="alert" className="mt-2 text-center text-[9px] font-bold text-red-500">{sourceError}</p>}
                    </div>
                  </div>

                  {/* QUICK STATS */}
                  <div className="grid grid-cols-2 border-b border-slate-200 dark:border-slate-800">
                    <div className="p-4 lg:p-5 relative overflow-hidden flex flex-col justify-center border-r border-slate-200 dark:border-slate-800">
                      <Activity size={16} className="text-blue-500 mb-2" />
                      <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Events Today</p>
                      <p className="text-xl font-black text-slate-900 dark:text-white mt-1">{eventsToday ?? '--'}</p>
                    </div>
                    <div className="p-4 lg:p-5 relative overflow-hidden flex flex-col justify-center">
                      <Clock size={16} className="text-amber-500 mb-2" />
                      <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Last Update</p>
                      <p className="text-xl font-black text-slate-900 dark:text-white mt-1">{lastUpdate}</p>
                    </div>
                  </div>

                  {/* AT A GLANCE MINI-BAR */}
                  <div className="p-6 lg:p-8 flex flex-col justify-center relative overflow-hidden">
                    <div className="flex items-center justify-between mb-5">
                      <h4 className="text-[10px] font-black tracking-[0.2em] uppercase text-slate-400 dark:text-slate-500">Today At A Glance</h4>
                      <Link to="/calendar" className="text-[9px] font-bold text-blue-500 hover:text-blue-600 uppercase tracking-widest flex items-center gap-1 transition-colors"><CalendarIcon size={12}/> Analytics</Link>
                    </div>

                    <div className="w-full h-3 flex rounded-full overflow-hidden mb-4 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 shadow-inner">
                      {todayTrend.map((point, i) => {
                        if (i === todayTrend.length - 1) return null;
                        const durationMs = todayTrend[i + 1].timestamp - point.timestamp;
                        const bgColor = point.level === 1 
                          ? (point.status === 'NEPA' ? 'bg-emerald-500' : 'bg-amber-500') 
                          : 'bg-slate-300 dark:bg-slate-700';

                        return (
                          <div 
                            key={i}
                            className={`h-full ${bgColor} border-r border-black/10 dark:border-white/5 last:border-0`}
                            style={{ width: `${(durationMs / DAY_MS) * 100}%` }}
                          />
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500" /><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Grid</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500" /><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Gen</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700" /><span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Downtime</span></div>
                    </div>
                  </div>

                </div>

                {/* RIGHT COLUMN */}
                <div className="lg:col-span-8 flex flex-col">
                  
                  <div className="p-6 lg:p-8 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50">
                    <div>
                      <h3 className="text-xl font-black tracking-tight text-slate-900 dark:text-white uppercase">Activity Timeline</h3>
                      <p className={`text-[10px] font-bold tracking-widest uppercase mt-1 ${logsError ? 'text-red-500' : 'text-slate-500'}`} role={logsError ? 'alert' : undefined}>
                        {logsError || 'Log of Time-Out Events'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg">
                      <Clock size={14} className="text-blue-600 dark:text-blue-500" />
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Real-Time</span>
                    </div>
                  </div>
                  
                  {logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center flex-1 py-16 opacity-30 dark:opacity-20">
                      <ZapOff size={48} className="text-slate-800 dark:text-slate-200" />
                      <p className="mt-4 font-bold tracking-widest uppercase text-xs text-slate-800 dark:text-slate-200">{logsError || 'No Records Found'}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col flex-1">
                      {logs.map((log, index) => {
                        const relativeDay = getRelativeDay(log.timestamp);

                        return (
                          <div key={index} className={`flex flex-row items-center justify-between p-4 lg:p-6 transition-colors group hover:bg-slate-50 dark:hover:bg-slate-900/40 ${
                            log.event === 'ON' 
                              ? 'border-b-[6px] border-slate-200 dark:border-slate-800' 
                              : 'border-b border-slate-100 dark:border-slate-800/50'
                          }`}>
                            
                            <div className="flex items-center gap-4 min-w-0">
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shrink-0 ${log.event === 'ON' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                                {log.event === 'ON' ? <Zap size={16} /> : <ZapOff size={16} />}
                              </div>
                              
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-sm sm:text-base font-black tracking-tight truncate ${log.event === 'ON' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {log.event === 'ON' ? 'Power Restored' : 'Power Interrupted'}
                                  </span>
                                  
                                  {log.event === 'ON' && (
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 border uppercase tracking-widest shrink-0 rounded ${
                                      log.source === 'NEPA' 
                                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' 
                                        : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                                    }`}>
                                      {log.source}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5 truncate">
                                  {relativeDay && (
                                    <span className="text-[8px] font-black text-blue-500 dark:text-blue-400 tracking-tighter bg-blue-500/10 px-1 rounded shrink-0">
                                      {relativeDay}
                                    </span>
                                  )}
                                  <p className="text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-widest italic truncate">
                                    {formatFullDate(log.timestamp)}
                                  </p>
                                </div>
                              </div>
                            </div>

                            <div className="text-right pl-2 shrink-0">
                              <p className={`text-xl sm:text-2xl font-black tracking-tighter ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                                {new Date(log.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                              </p>
                              <p className="text-slate-400 dark:text-slate-600 text-[10px] font-mono font-bold mt-[-2px]">
                                :{String(new Date(log.timestamp).getSeconds()).padStart(2, '0')}s
                              </p>
                            </div>
                            
                          </div>
                        );
                      })}
                    </div>
                  )}
                  
                  <div className="p-4 lg:p-6 bg-slate-50 dark:bg-slate-900/30 border-t border-slate-100 dark:border-slate-800/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Info size={16} className="text-blue-500 shrink-0" />
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                        Capturing exact ESP32 network pings.
                      </p>
                    </div>
                    
                    <Link 
                      to="/history" 
                      className="flex items-center gap-2 px-6 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 border border-slate-900 dark:border-white text-[10px] font-black uppercase tracking-[0.2em] transition-all hover:opacity-80 whitespace-nowrap"
                    >
                      <Activity size={14} /> Full Archive
                    </Link>
                  </div>

                </div>

              </div>
            } />
            
            <Route path="/calendar" element={<Analytics darkMode={darkMode} />} />
            <Route path="/history" element={<History darkMode={darkMode} />} />
          </Routes>
        </main>

        <AuthModal 
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          onSubmit={submitPassword}
          error={authError}
          pending={sourcePending}
          showPending={showSourcePending}
        />

      </div>
    </div>
  )
}

export default App
