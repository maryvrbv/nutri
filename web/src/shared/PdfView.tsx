import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Страницы PDF рисуются на canvas: встроенный просмотрщик браузера на телефонах
 * в iframe обычно не работает, а исходник должен быть виден рядом со значениями.
 */
export function PdfView({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    const el = box.current!;
    el.innerHTML = '';
    (async () => {
      try {
        const doc = await pdfjs.getDocument({ url: src, isEvalSupported: false, withCredentials: true }).promise;
        const width = el.clientWidth || 600;
        for (let n = 1; n <= Math.min(doc.numPages, 20); n++) {
          if (cancelled) return;
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const ratio = window.devicePixelRatio || 1;
          const vp = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width; canvas.height = vp.height;
          canvas.style.width = '100%'; canvas.style.display = 'block'; canvas.style.background = '#fff';
          canvas.setAttribute('aria-label', `Страница ${n}`);
          if (n > 1) canvas.style.marginTop = '8px';
          el.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
        }
        if (!cancelled) setState('ok');
        doc.destroy();
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [src]);
  return (
    <div>
      {state === 'loading' && <div style={{ padding: 24, display: 'grid', placeItems: 'center' }}><div className="spinner" aria-label="Загружаем документ" /></div>}
      {state === 'error' && <p className="small muted" style={{ padding: 16 }}>Не получилось показать документ. Откройте его отдельно по ссылке ниже.</p>}
      <div ref={box} style={{ maxHeight: '75vh', overflow: 'auto' }} role="img" aria-label="Исходный документ" />
    </div>
  );
}
