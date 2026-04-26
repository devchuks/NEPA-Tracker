import { useState, useEffect } from 'react';
import { Download, ChevronLeft, ChevronRight, Zap, ZapOff, Database, Edit2, Trash2, Plus, X } from 'lucide-react';

export default function History({ darkMode }) {
  const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.140:8000';

  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  // --- MODAL STATE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    id: null,
    event: 'ON',
    source: 'NEPA',
    timestamp: ''
  });

  const fetchHistory = async () => {
    const res = await fetch(`${API_URL}/api/logs/all?page=${page}&limit=${limit}`);
    const data = await res.json();
    setLogs(data.logs);
    setTotal(data.total);
  };

  useEffect(() => { fetchHistory(); }, [page]);

  const downloadCSV = () => {
    window.location.href = `${API_URL}/api/logs/export`;
  };

  // --- FORMATTING HELPERS ---
  const toLocalIsoString = (dateString) => {
    const d = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z');
    const pad = (n) => String(n).padStart(2, '0');
    // Returns the format YYYY-MM-DDTHH:mm:ss required by the browser input
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  // --- CRUD ACTIONS ---
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
        timestamp: toLocalIsoString(new Date().toISOString())
      });
    }
    setIsModalOpen(true);
  };

  const saveLog = async () => {
    const payload = {
      event: editForm.event,
      source: editForm.event === 'ON' ? editForm.source : null,
      timestamp: new Date(editForm.timestamp).toISOString()
    };

    const url = editForm.id 
      ? `${API_URL}/api/logs/${editForm.id}`
      : `${API_URL}/api/logs/manual`;
    
    const method = editForm.id ? 'PUT' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    setIsModalOpen(false);
    fetchHistory();
  };

  const deleteLog = async (id) => {
    if(!window.confirm("Delete this power log forever?")) return;
    await fetch(`${API_URL}/api/logs/${id}`, { method: 'DELETE' });
    fetchHistory();
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
          <div className="col-span-4">Status Event</div>
          <div className="col-span-3">Power Source</div>
          <div className="col-span-3">Date & Time</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
          {logs.map((log) => (
            <div key={log.id} className={`flex flex-col sm:grid sm:grid-cols-12 sm:items-center p-4 sm:p-5 transition-colors gap-3 sm:gap-0 hover:bg-slate-50 dark:hover:bg-slate-800/30 ${
              log.event === 'ON' 
                ? 'border-b-[6px] border-slate-200 dark:border-slate-800' 
                : 'border-b border-slate-100 dark:border-slate-800/50'
            }`}>
              
              <div className="flex items-center justify-between sm:col-span-4">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${log.event === 'ON' ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                    {log.event === 'ON' ? <Zap size={14} /> : <ZapOff size={14} />}
                  </div>
                  <span className={`text-xs font-bold uppercase tracking-widest ${log.event === 'ON' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {log.event === 'ON' ? 'Power Restored' : 'Interrupted'}
                  </span>
                </div>

                <div className="flex sm:hidden gap-4">
                  <button onClick={() => openModal(log)} className="text-slate-400 hover:text-blue-500 transition-colors"><Edit2 size={16} /></button>
                  <button onClick={() => deleteLog(log.id)} className="text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
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
  
  {/* TIME BLOCK (Dashboard Style) */}
  <div className="flex flex-col text-right sm:text-left shrink-0 min-w-[80px]">
    <span className="text-xl sm:text-2xl font-black tracking-tighter text-slate-900 dark:text-white leading-none">
      {new Date(log.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
    </span>
    <span className="text-slate-400 dark:text-slate-600 text-[10px] font-mono font-bold mt-1 sm:mt-0.5">
      :{String(new Date(log.timestamp).getSeconds()).padStart(2, '0')}s
    </span>
  </div>

  {/* DATE BLOCK (The "New Column") */}
  <div className="flex flex-col items-end sm:items-start sm:border-l sm:border-slate-200 sm:dark:border-slate-800 sm:pl-6">
    <span className="text-[10px] sm:text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight">
      {(() => {
        const d = new Date(log.timestamp);
        const day = d.getDate();
        const month = d.toLocaleDateString('en-GB', { month: 'long' });
        const year = d.getFullYear();
        
        // Ordinal logic: 1st, 2nd, 3rd, 4th, etc.
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
                <button onClick={() => deleteLog(log.id)} className="text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
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

      {/* --- CRUD MODAL --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#020617] border border-slate-200 dark:border-slate-800 p-6 w-full max-w-md shadow-2xl relative">
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
                onClick={saveLog}
                className="w-full mt-4 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black text-xs uppercase tracking-[0.2em] hover:opacity-90 transition-opacity"
              >
                {editForm.id ? 'Save Changes' : 'Inject Record'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}