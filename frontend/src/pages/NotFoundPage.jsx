import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Page not found</h1>
      <p className="mt-2 text-slate-300">That page does not exist.</p>
      <Link className="mt-4 inline-block text-sky-300 underline" to="/">
        Back to the start
      </Link>
    </div>
  );
}
