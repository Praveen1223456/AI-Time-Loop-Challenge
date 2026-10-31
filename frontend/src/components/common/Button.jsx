const VARIANTS = {
  primary: 'bg-sky-400 text-slate-950 hover:bg-sky-300 disabled:bg-slate-600 disabled:text-slate-300',
  secondary: 'border border-slate-500 text-slate-100 hover:bg-slate-800 disabled:text-slate-500 disabled:border-slate-700',
  danger: 'border border-rose-400 text-rose-100 hover:bg-rose-950 disabled:text-slate-500 disabled:border-slate-700',
};

export default function Button({ variant = 'secondary', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
