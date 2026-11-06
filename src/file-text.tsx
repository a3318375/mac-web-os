import { useEffect, useState } from 'react';

export default function FileText({ source }: { source: string }) {
  const [result, setResult] = useState<{ text?: string; error?: string }>();
  useEffect(() => {
    const request = new AbortController();
    fetch(source + '&preview=1', { signal: request.signal }).then(async response => {
      if (!response.ok) throw new Error((await response.json()).error);
      return response.text();
    }).then(text => setResult({ text })).catch(error => {
      if (!request.signal.aborted) setResult({ error: error.message || '无法读取文本。' });
    });
    return () => request.abort();
  }, [source]);

  if (!result || result.error) return <p role="status">{result?.error ?? '正在读取文本…'}</p>;
  return <pre>{result.text}</pre>;
}
