// Тема выставляется до отрисовки, чтобы не мигала. Отдельный файл — политика безопасности запрещает встроенные скрипты.
try { if (localStorage.getItem('nutri:theme') === 'pastel') document.documentElement.dataset.theme = 'pastel'; } catch (e) { /* хранилище недоступно */ }
