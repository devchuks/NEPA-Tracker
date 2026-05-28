import { useState, useEffect } from 'react';
import { Download, ChevronLeft, ChevronRight, Zap, ZapOff, Database, Edit2, Trash2, Plus, X, Loader2 } from 'lucide-react';
import AuthModal from './AuthModal'; // <-- IMPORTED NEW COMPONENT

export default function History({ darkMode }) {
  const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.140:8000';

  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;
  const [selectedLogs, setSelectedLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // --- CRUD MODAL STATES ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    id: null,
    event: 'ON',
    source: 'NEPA',
    timestamp: ''
  });

  // --- PREMIUM AUTH & DELETE STATES ---
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [pendingAction, setPendingAction] = useState(null); // 'save' or 'delete'

  const fetchHistory = async () => {
    setIsLoading(true);
    const res = await fetch(`${API_URL}/api/logs/all?page=${page}&limit=${limit}`);
    const data = await res.json();
    setLogs(data.logs);
    setTotal(data.total);
    setIsLoading(false);
  };

  useEffect(() => { 
    fetchHistory(); 
    setSelectedLogs([]); 
  }, [page]);

  const toggleSelect = (id) => {
    setSelectedLogs(prev => prev.includes(id) ? prev.filter(logId => logId !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedLogs.length === logs.length && logs.length > 0) {
      setSelectedLogs([]);
    } else {
      setSelectedLogs(logs.map(log => log.id));
    }
  };

  const downloadCSV = () => {
    window.location.href = `${API_URL}/api/logs/export`;
  };

  const toLocalIsoString = (dateInput) => {
    if (typeof dateInput === 'string' && dateInput.includes('T')) {
      return dateInput.substring(0, 19);
    }
    const d = dateInput instanceof Date ? dateInput : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const openModal = (log = null) => {
    if (log) {
      setEditForm({
        id: log.id,
        event: log.event,
        source: log.source || 'NEPA',
        timestamp: toLocalIsoString(log.timestamp)
      });
    } else {
      setEditForm({
        id: null,
        event: 'ON',
        source: 'NEPA',
        timestamp: toLocalIsoString(new Date())
      });
    }
    setIsModalOpen(true);
  };

  // --- INTERCEPTED SAVE LOGIC ---
  const initiateSave = () => {
    const token = localStorage.getItem("adminToken");
    setAuthError("");
    if (!token) {
      setPendingAction('save');
      setIsAuthModalOpen(true);
      return;
    }
    executeSave(token);
  };

  const executeSave = async (token) => {
    const payload = {
      event: editForm.event,
      source: editForm.event === 'ON' ? editForm.source : null,
      timestamp: editForm.timestamp
    };

    const url = editForm.id 
      ? `${API_URL}/api/logs/${editForm.id}`
      : `${API_URL}/api/logs/manual`;
    
    const method = editForm.id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Token': token
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 403) {
      localStorage.removeItem("adminToken");
      setAuthError("Invalid or expired password");
      setPendingAction('save');
      setIsAuthModalOpen(true);
    } else {
      setAuthError("");
      setIsAuthModalOpen(false);
      setIsModalOpen(false);
      setPendingAction(null);
      fetchHistory();
    }
  };

  // --- INTERCEPTED DELETE LOGIC ---
  const triggerDelete = (id) => {
    setDeleteTarget(id);
  };

  const confirmDelete = () => {
    const token = localStorage.getItem("adminToken");
    setAuthError("");
    if (!token) {
      setPendingAction('delete');
      setIsAuthModalOpen(true);
      return;
    }
    
    if (deleteTarget === 'bulk') {
      executeBulkDelete(token);
    } else {
      executeDelete(token);
    }
  };

  const executeBulkDelete = async (token) => {
    const res = await fetch(`${API_URL}/api/logs/bulk-delete`, { 
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Token': token 
      },
      body: JSON.stringify({ log_ids: selectedLogs })
    });

    if (res.status === 403) {
      localStorage.removeItem("adminToken");
      setAuthError("Invalid or expired password");
      setPendingAction('delete');
      setIsAuthModalOpen(true);
    } else {
      setAuthError("");
      setIsAuthModalOpen(false);
      setDeleteTarget(null);
      setPendingAction(null);
      setSelectedLogs([]);
      fetchHistory();
    }
  };

  const executeDelete = async (token) => {
    const res = await fetch(`${API_URL}/api/logs/${deleteTarget}`, { 
      method: 'DELETE',
      headers: { 'X-Admin-Token': token } 
    });

    if (res.status === 403) {
      localStorage.removeItem("adminToken");
      setAuthError("Invalid or expired password");
      setPendingAction('delete');
      setIsAuthModalOpen(true);
    } else {
      setAuthError("");
      setIsAuthModalOpen(false);
      setDeleteTarget(null);
      setPendingAction(null);
      fetchHistory();
    }
  };

  // --- GLOBAL AUTH SUBMISSION ---
  const submitPassword = (token) => {
    localStorage.setItem("adminToken", token);
    if (pendingAction === 'save') executeSave(token);
    if (pendingAction === 'delete') {
      if (deleteTarget === 'bulk') executeBulkDelete(token);
      else executeDelete(token);
    }
  };

  return (
    <div className="space-y-6 relative">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white uppercase">Archive Vault</h2>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Full Power Event Records</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          {selectedLogs.length > 0 && (
            <button 
              onClick={() => setDeleteTarget('bulk')}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-none font-black text-[10px] uppercase tracking-widest transition-all shadow-md shadow-red-500/20 active:opacity-50"
            >
              <Trash2 size={14} /> Delete ({selectedLogs.length})
            </button>
          )}
          <button 
            onClick={() => openModal()}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-700 hover:border-slate-900 dark:hover:border-white text-slate-900 dark:text-white rounded-none font-black text-[10px] uppercase tracking-widest transition-all active:opacity-50"
          >
            <Plus size={14} /> Add Entry
          </button>
          <button 
            onClick={downloadCSV}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-[#10b981] hover:bg-[#059669] text-white rounded-none font-black text-[10px] uppercase tracking-widest transition-all shadow-md shadow-emerald-500/20 active:opacity-50"
          >
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 shadow-xl dark:shadow-2xl">
        
        {/* Desktop Headers */}
        <div className="hidden sm:grid sm:grid-cols-12 bg-slate-50 dark:bg-[#020617] border-b border-slate-200 dark:border-slate-800 p-5 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <div className="col-span-4 flex items-center gap-3">
            <input type="checkbox" checked={selectedLogs.length === logs.length && logs.length > 0} onChange={toggleSelectAll} className="w-3.5 h-3.5 cursor-pointer accent-blue-600" />
            <span>Status Event</span>
          </div>
          <div className="col-span-3">Power Source</div>
          <div className="col-span-3">Date & Time</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800/50 relative min-h-[200px]">
          {isLoading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 dark:bg-[#020617]/50 backdrop-blur-[2px]">
              <Loader2 className="animate-spin text-emerald-500" size={32} />
            </div>
          )}
          {logs.map((log) => (
            <div key={log.id} className={`flex flex-col sm:grid sm:grid-cols-12 sm:items-center p-4 sm:p-5 transition-colors gap-3 sm:gap-0 hover:bg-slate-50 dark:hover:bg-slate-800/30 ${
              log.event === 'ON' 
                ? 'border-b-[6px] border-slate-200 dark:border-slate-800' 
                : 'border-b border-slate-100 dark:border-slate-800/50'
            }`}>
              
              <div className="flex items-center justify-between sm:col-span-4">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={selectedLogs.includes(log.id)} onChange={() => toggleSelect(log.id)} className="w-4 h-4 cursor-pointer accent-blue-600" />
                  <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${log.event === 'ON' ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                    {log.event === 'ON' ? <Zap size={14} /> : <ZapOff size={14} />}
                  </div>
                  <span className={`text-xs font-bold uppercase tracking-widest ${log.event === 'ON' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {log.event === 'ON' ? 'Power Restored' : 'Interrupted'}
                  </span>
                </div>

                <div className="flex sm:hidden gap-4">
                  <button onClick={() => openModal(log)} className="text-slate-400 hover:text-blue-500 transition-colors"><Edit2 size={16} /></button>
                  <button onClick={() => triggerDelete(log.id)} className="text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                </div>
              </div>

              <div className="flex sm:col-span-3 items-center">
                {log.event === 'ON' ? (
                  <span className={`text-[9px] font-black px-2 py-1 border uppercase tracking-widest ${
                    log.source === 'NEPA' 
                      ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20' 
                      : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20'
                  }`}>
                    {log.source}
                  </span>
                ) : (
                  <span className="text-[9px] font-black px-2 py-1 border uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700">
                    SYSTEM OFFLINE
                  </span>
                )}
              </div>

              <div className="flex sm:col-span-3 justify-between sm:justify-start items-center sm:gap-8 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800/50">
  
                <div className="flex flex-col text-right sm:text-left shrink-0 min-w-[80px]">
                  <span className="text-xl sm:text-2xl font-black tracking-tighter text-slate-900 dark:text-white leading-none">
                    {new Date(log.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  </span>
                  <span className="text-slate-400 dark:text-slate-600 text-[10px] font-mono font-bold mt-1 sm:mt-0.5">
                    :{String(new Date(log.timestamp).getSeconds()).padStart(2, '0')}s
                  </span>
                </div>

                <div className="flex flex-col items-end sm:items-start sm:border-l sm:border-slate-200 sm:dark:border-slate-800 sm:pl-6">
                  <span className="text-[10px] sm:text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    {(() => {
                      const d = new Date(log.timestamp);
                      const day = d.getDate();
                      const month = d.toLocaleDateString('en-GB', { month: 'long' });
                      const year = d.getFullYear();
                      
                      const ord = (n) => {
                        if (n > 3 && n < 21) return 'th';
                        switch (n % 10) {
                          case 1: return "st";
                          case 2: return "nd";
                          case 3: return "rd";
                          default: return "th";
                        }
                      };

                      return `${day}${ord(day)} ${month}, ${year}`;
                    })()}
                  </span>
                  <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">
                    {new Date(log.timestamp).toLocaleDateString('en-GB', { weekday: 'short' })}
                  </span>
                </div>
              </div>
              <div className="hidden sm:flex sm:col-span-2 justify-end gap-3">
                <button onClick={() => openModal(log)} className="text-slate-400 hover:text-blue-500 transition-colors"><Edit2 size={16} /></button>
                <button onClick={() => triggerDelete(log.id)} className="text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
              </div>

            </div>
          ))}
        </div>

        <div className="p-4 sm:p-5 flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-50 dark:bg-[#020617] border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Database size={14} className="text-slate-400" />
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Page {page} of {Math.max(1, Math.ceil(total / limit))} <span className="hidden sm:inline">({total} Records)</span>
            </span>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="flex-1 sm:flex-none flex justify-center p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"><ChevronLeft size={16}/></button>
            <button disabled={page * limit >= total} onClick={() => setPage(p => p + 1)} className="flex-1 sm:flex-none flex justify-center p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"><ChevronRight size={16}/></button>
          </div>
        </div>
      </div>

      {/* --- CRUD MODAL (z-100) --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/20 dark:bg-slate-950/60 backdrop-blur-md transition-colors">
          <div className="bg-white dark:bg-[#020617] border border-slate-200 dark:border-slate-800 p-6 w-full max-w-md shadow-2xl dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative transition-colors">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"><X size={20} /></button>
            
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900 dark:text-white mb-6">
              {editForm.id ? 'Edit Log Entry' : 'New Manual Entry'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Event Type</label>
                <div className="flex border border-slate-200 dark:border-slate-800 p-1 bg-slate-50 dark:bg-slate-900">
                  <button onClick={() => setEditForm({...editForm, event: 'ON'})} className={`flex-1 py-2 text-[10px] font-black tracking-widest ${editForm.event === 'ON' ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`}>GRID ONLINE (ON)</button>
                  <button onClick={() => setEditForm({...editForm, event: 'OFF'})} className={`flex-1 py-2 text-[10px] font-black tracking-widest ${editForm.event === 'OFF' ? 'bg-red-500 text-white' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`}>OUTAGE (OFF)</button>
                </div>
              </div>

              {editForm.event === 'ON' && (
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Power Source</label>
                  <div className="flex border border-slate-200 dark:border-slate-800 p-1 bg-slate-50 dark:bg-slate-900">
                    <button onClick={() => setEditForm({...editForm, source: 'NEPA'})} className={`flex-1 py-2 text-[10px] font-black tracking-widest ${editForm.source === 'NEPA' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`}>NEPA</button>
                    <button onClick={() => setEditForm({...editForm, source: 'GEN'})} className={`flex-1 py-2 text-[10px] font-black tracking-widest ${editForm.source === 'GEN' ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`}>GENERATOR</button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Exact Date & Time</label>
                <input 
                  type="datetime-local" 
                  step="1"
                  value={editForm.timestamp}
                  onChange={(e) => setEditForm({...editForm, timestamp: e.target.value})}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white p-3 text-sm font-mono outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <button 
                onClick={initiateSave}
                className="w-full mt-4 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black text-xs uppercase tracking-[0.2em] hover:opacity-90 transition-opacity"
              >
                {editForm.id ? 'Save Changes' : 'Inject Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- PREMIUM DELETE MODAL (z-200) --- */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/20 dark:bg-slate-950/60 backdrop-blur-md transition-colors">
          <div className="bg-white dark:bg-[#020617] border border-slate-200 dark:border-slate-800 p-8 w-full max-w-sm shadow-2xl dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] text-center transition-colors">
            <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 size={32} />
            </div>
            <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900 dark:text-white mb-2">{deleteTarget === 'bulk' ? 'Delete Selected?' : 'Confirm Delete?'}</h3>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-6">{deleteTarget === 'bulk' ? `You are about to delete ${selectedLogs.length} records.` : 'This record will be removed forever.'}</p>
            
            <div className="flex gap-3">
              <button 
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-3 border border-slate-200 dark:border-slate-800 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-900 transition-all"
              >
                Exit
              </button>
              <button 
                onClick={confirmDelete}
                className="flex-1 py-3 bg-red-600 text-white font-black text-[10px] uppercase tracking-widest shadow-lg shadow-red-600/20 hover:bg-red-700 transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- NEW SHARED AUTH MODAL (z-300) --- */}
      <AuthModal 
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSubmit={submitPassword}
        error={authError}
        message="Enter password to authorize changes."
      />

    </div>
  );
}