import { useState, useEffect } from 'react';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function AuthModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  error, 
  title = "Admin Access", 
  message = "Enter password to authorize changes." 
}) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Reset the input every time the modal opens
  useEffect(() => {
    if (isOpen) {
      setPassword("");
      setShowPassword(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/20 dark:bg-slate-950/60 backdrop-blur-md transition-colors">
      <div className="bg-white dark:bg-[#020617] border border-slate-200 dark:border-slate-800 p-8 w-full max-w-sm shadow-2xl dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative transition-colors">
        
        <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900 dark:text-white mb-2 text-center">
          {title}
        </h3>
        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-6 text-center">
          {message}
        </p>
        
        <div className="relative mb-6">
          <input 
            type={showPassword ? "text" : "password"}
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && password && onSubmit(password)}
            className={`w-full bg-slate-50 dark:bg-slate-900 border ${error ? 'border-red-500 dark:border-red-500' : 'border-slate-200 dark:border-slate-800 focus:border-blue-500 dark:focus:border-blue-500'} text-slate-900 dark:text-white p-4 pr-12 text-sm font-black outline-none transition-colors tracking-widest`}
            placeholder="••••••••"
          />
          <button 
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>

          {/* Inline Error Warning */}
          {error && (
            <div className="absolute -bottom-5 left-0 flex items-center gap-1.5 text-red-500">
              <AlertCircle size={12} />
              <span className="text-[9px] font-black uppercase tracking-widest">{error}</span>
            </div>
          )}
        </div>
        
        <div className="flex gap-3 mt-8">
          <button 
            onClick={onClose} 
            className="flex-1 py-3 border border-slate-200 dark:border-slate-800 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-900 transition-all"
          >
            Cancel
          </button>
          <button 
            onClick={() => password && onSubmit(password)} 
            disabled={!password}
            className="flex-1 py-3 bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-all"
          >
            Authorize
          </button>
        </div>

      </div>
    </div>
  );
}