// app.js
// Инициализация приложения после загрузки DOM.

document.addEventListener('DOMContentLoaded', async () => {
    loadTheme();
    
    // Проверяем, есть ли сохранённые зашифрованные данные
    const hasEncryptedData = localStorage.getItem('contacts_encrypted') !== null;
    
    if (hasEncryptedData) {
        await showMasterPasswordPrompt(false);
    } else {
        // Спрашиваем, хочет ли пользователь установить мастер-пароль
        const wantsProtection = confirm(
            '🔐 Хотите защитить чаты мастер-паролем?\n\n' +
            'Без пароля ваши ключи и история будут храниться в открытом виде.\n' +
            'Нажмите "OK" чтобы создать пароль, или "Отмена" чтобы продолжить без защиты.'
        );
        if (wantsProtection) {
            await showMasterPasswordPrompt(true);
        }
    }
    
    await loadSettings();
    
    $('main-chat').classList.add('hidden');

    $('new-chat-btn').addEventListener('click', showNewChat);
    $('sidebar-toggle').addEventListener('click', toggleSidebar);

    $('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

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

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeNewChat();
            closeSettings();
        }
    });
});