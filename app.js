// app.js
// Инициализация приложения после загрузки DOM.
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    loadSettings();
    $('main-chat').classList.add('hidden');

    $('new-chat-btn').addEventListener('click', showNewChat);
    $('sidebar-toggle').addEventListener('click', toggleSidebar);

    $('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Умная активация кнопок при вставке SDP
    $('host-answer-input').addEventListener('input', (e) => {
        try {
            JSON.parse(e.target.value.trim());
            $('host-connect-btn').disabled = false;
        } catch { $('host-connect-btn').disabled = true; }
    });

    $('join-offer-input').addEventListener('input', (e) => {
        try {
            JSON.parse(e.target.value.trim());
            $('join-generate-btn').disabled = false;
        } catch { $('join-generate-btn').disabled = true; }
    });

    // Закрытие модалок по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeNewChat();
            closeSettings();
        }
    });
});